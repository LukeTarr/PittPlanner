FROM node
WORKDIR /app
COPY package.json /app
RUN npm install
COPY . /app
EXPOSE 4444
CMD ["npm","start"]
