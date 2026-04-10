FROM node:20-alpine

# Install ffmpeg for audio processing (required by fluent-ffmpeg)
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

# Environment variables
ENV PORT=5000
# SIP needs specific ports. While we expose them here, 
# network_mode: host in docker-compose is recommended for SIP/VoIP.
EXPOSE 5000
EXPOSE 5060/udp
EXPOSE 5060/tcp

# Run the app
CMD ["npm", "start"]
