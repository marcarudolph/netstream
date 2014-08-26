FROM google/nodejs
MAINTAINER marcarudolph

ADD package.json /server/
WORKDIR /server
RUN npm install

ADD ./ /server/

EXPOSE 8080
CMD ["node", "server.js"]
