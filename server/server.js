var http = require('http');
var url = require('url');

var devices = [
//{ host: 'netstream01.insolo.local', port: 80, channels: {} },
{ host: 'netstream02.insolo.local', port: 80, channels: {} }
];

var tuners = [
{ device: devices[0], index: 1 },
{ device: devices[0], index: 2 },
//{ device: devices[1], index: 1 },
//{ device: devices[1], index: 2 }
];

function getChannelInfos(device, continueWith) {
    var requestData = { method: "Toma.GetFavourites", id: 0 };
    var requestBody = JSON.stringify(requestData);

    var client = http.createClient(device.port, device.host);

    var req = client.request('POST', '/control', { 'Content-Length': requestBody.length });

    req.on('response', function (res) {
        res.setEncoding('utf8');

        var body = '';
        res.on('data', function (chunk) {
            body += chunk;
        });

        res.on('end', function (chunk) {
            var responseData = JSON.parse(body);
            var channels = responseData.Favourites[0].FavouriteItems;
            continueWith({ device: device, channels: channels });
        });

    });

    req.end(requestBody);
}

function storeChannelInfos(deviceChannels) {
    var device = deviceChannels.device;

    device.channels = {};

    for (var idx = 0; idx < deviceChannels.channels.length; idx++) {
        var channel = deviceChannels.channels[idx];
        device.channels[channel.Name] = channel;
    }
}



function getTunerInfos(continueWith) {

    var tunerInfos = [];
    var remainingInfoCount = tuners.length;

    for (var idx = 0; idx < tuners.length; idx++) {

        function requestTuner(idx) {
            var tuner = tuners[idx];

            console.log('requestTuner: ' + tuner.device.host + '/' + tuner.index);

            var requestData =
            {
                "method": "Toma.GetTunerInformation",
                "id": 0, "params": { "TunerIndex": tuner.index }
            };
            var requestBody = JSON.stringify(requestData);

            var client = http.createClient(tuner.device.port, tuner.device.host);

            var req = client.request('POST', '/control', { 'Content-Length': requestBody.length });

            req.on('response', function (res) {
                res.setEncoding('utf8');
                console.log('got requestTuner response: ' + tuner.device.host + '/' + tuner.index);

                var body = '';
                res.on('data', function (chunk) {
                    body += chunk;
                });

                res.on('end', function (chunk) {
                    var responseData = JSON.parse(body);
                    var tunerInfo =
                    {
                        tuner: tuner,
                        isInUse: responseData.TunerStatus.ActiveStreams > 0,
                        channelName: responseData.ChannelName,
                        activeStreams: responseData.TunerStatus.ActiveStreams,
                        streamingPort: responseData.StreamingPort
                    };

                    tunerInfos[idx] = tunerInfo;

                    if (--remainingInfoCount === 0)
                        continueWith(tunerInfos);
                });

            });

            req.end(requestBody);
        }
        requestTuner(idx);
    }
}

function sendTuneRequest(device, tunerequestKey, continueWith) {
    console.log('sendTuneRequest: ' + tunerequestKey);
    var path = '/stream/tunerequest' + tunerequestKey;

    var client = http.createClient(device.port, device.host);

    var req = client.request('POST', path, { 'Content-Length': 0 });

    req.on('response', function (res) {
        var streamUri = res.headers['location'];
        var uriInfos = url.parse(streamUri);

        continueWith({ streamingPort: uriInfos.port });
    });

    req.end();
}

function tuneChannel(channelName, continueWith) {
    console.log('tuneChannel: ' + channelName);
    getTunerInfos(function (tunerInfos) {
        console.log('getTunerInfos Completed');
        var activeChannels = {};
        for (var idx = 0; idx < tunerInfos.length; idx++) {
            var tunerInfo = tunerInfos[idx];
            activeChannels[tunerInfo.channelName] = tunerInfo;
        }

        var firstFreeTunerInfo = null;
        for (var idx = 0; idx < tunerInfos.length; idx++) {
            var tunerInfo = tunerInfos[idx];
            if (!tunerInfo.isInUse) {
                firstFreeTunerInfo = tunerInfo;
                break;
            }
        }

        if (channelName in activeChannels) {
            var matchingTunerInfo = activeChannels[channelName];
            console.log('Found active tuner for channel ' + channelName);
            continueWith({ success: true, host: matchingTunerInfo.tuner.device.host, streamingPort: matchingTunerInfo.streamingPort });
        }
        else if (firstFreeTunerInfo === null) {
            continueWith({ success: false, reason: 'No free tuner' });
        }
        else {
            var device = firstFreeTunerInfo.tuner.device;
            var channel = device.channels[channelName];
            if (channel === undefined) {
                continueWith({ success: false, reason: 'Unknown channel name "' + channelName + '"' });
                return;
            }
            sendTuneRequest(device, channel.TunerequestKey, function (tuneResult) {
                continueWith({ success: true, host: device.host, streamingPort: tuneResult.streamingPort });
            });
        }
    });
}

function initChannelInfosForAllDevices(continueWith) {
    var idx = 0;
    var getAndStoreAndContinue = function (recurse) {
        getChannelInfos(devices[idx], function (channelInfos) {
            storeChannelInfos(channelInfos);
            if (++idx < devices.length) {
                recurse(recurse);
            }
            else {
                continueWith();
            }
        });
    };
    getAndStoreAndContinue(getAndStoreAndContinue);
}

function initServer() {
    http.createServer(function (request, response) {
        var parsedUrl = url.parse(request.url);
        var streamPrefix = '/streams/';

        if (parsedUrl.pathname.indexOf(streamPrefix) === 0) {
            var uriEncodedChannelName = parsedUrl.pathname.replace(streamPrefix, '');
            var channelName = decodeURIComponent(uriEncodedChannelName).replace(/\+/g, ' ');

            tuneChannel(channelName, function (result) {
                if (result.success) {

                    var streamUrl = 'http://' + result.host + ':' + result.streamingPort;
                    console.log('redirecting client to ' + streamUrl);

                    response.writeHead(302, { 'location': streamUrl });
                    response.end();
                }
                else {
                    console.log('stream request failed with reason ' + result.reason);
                    response.writeHead(404, { 'Content-Type': 'text/plain' });
                    response.end('FAIL: ' + result.reason);
                }
            });
        }
        else {
            response.writeHead(404);
            response.end();
        }

    }).listen(8080);
}


initChannelInfosForAllDevices(function () {

    initServer();
    //    tuneChannel('arte HD', function (result) {
    //        if (result.success) {
    //            console.log('http://' + result.host + ':' + result.streamingPort);
    //        }
    //        else {
    //            console.log('FAIL: ' + result.reason);
    //        }
    //    });
});