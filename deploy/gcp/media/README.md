# Public RELAY demonstration page

Live demonstration: https://relay-demo-641101150486.us-central1.run.app/

This isolated Cloud Run service serves one approved final MP4, its poster and
English WebVTT captions. It has no database, VPC attachment, credentials, provider
integration, or application state. The existing RELAY web/worker services are
not modified. Nginx supplies static byte ranges for seeking; an MP4 processing
module is unnecessary. The page has native controls, optional native captions (the film already includes word captions),
and links to the live app and public source.

Do not publish until a release reviewer has checked the final media and publication is authorized. Never pass
the film project directory as a Cloud Build context. Use `prepare.py` to build a
new private directory containing exactly eight allowlisted hosting/media files:

```sh
python3 deploy/gcp/media/prepare.py \
  --video /absolute/path/to/final.mp4 \
  --poster /absolute/path/to/final-poster.png \
  --captions /absolute/path/to/final.vtt \
  --output /absolute/private/new-media-build
```

Keep the printed SHA-256 manifest with the private release verification record. Once publication is authorized,
create a dedicated `relay-media` service account with no project roles. The image
build uses the existing RELAY build identity. Set the authorized Google Cloud
account and optional SDK path as documented in the parent deployment instructions.
Then set `RELAY_MEDIA_BUILD_DIR` and a unique `RELAY_MEDIA_IMAGE` Artifact Registry
tag and run `publish.sh`. It does not request or mount secrets.

The service uses Google's documented public-access option because organization
policy restricts `allUsers` IAM bindings. Its maximum is one instance, minimum
zero, with request-based billing and 512 MiB memory. There is no fixed compute charge; build/image
storage and active requests/internet delivery incur small usage charges.

Verify the public page, MP4 `Content-Type: video/mp4`, poster image MIME type,
`text/vtt` captions, and a `Range: bytes=0-1023` response with status 206 and a
correct `Content-Range` before providing the URL to judges. Check native playback,
seeking, caption controls and the app/source links in a fresh browser.

The MP4 is limited to 30 MiB by the staging tool so full downloads stay within
Cloud Run’s HTTP/1 response limit. The current approved film is 177 seconds and
14,078,806 bytes. Anonymous page, video byte range (206), poster MIME, and
caption MIME/content checks passed. Browser checks confirmed playback, seeking
to about 90 seconds, and native caption selection.
