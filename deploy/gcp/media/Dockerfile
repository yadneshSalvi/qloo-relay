FROM nginx:stable-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951
COPY nginx.conf /etc/nginx/nginx.conf
COPY index.html RELAY-demo.mp4 poster captions.vtt /srv/
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
