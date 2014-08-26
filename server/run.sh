#! /bin/bash
docker kill netstream
docker rm netstream
docker run -d --name=netstream -p 80:8080 netstreamserver
