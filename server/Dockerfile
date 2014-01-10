FROM danscan/node
MAINTAINER marcarudolph
CMD node /server/server.js
EXPOSE 8080
ADD ./ /server/
RUN cd /server ; npm install
