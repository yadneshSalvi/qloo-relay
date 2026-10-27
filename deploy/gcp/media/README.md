# Public RELAY demonstration page

Live demonstration: https://relay-demo-641101150486.us-central1.run.app/

This isolated Cloud Run service serves one approved final MP4, its poster and
English WebVTT captions. It has no database, VPC attachment, credentials, provider
integration, or application state. The existing RELAY web/worker services are
not modified. Nginx supplies static byte ranges for seeking; an MP4 processing
module is unnecessary. The page has native controls, optional English captions, and links to the live app
and public source. The film has no burned-in captions or title bands. Versioned
media URLs keep a cached earlier film from replacing the current release.

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

The staging tool limits the MP4 to 128 MiB. Nginx accepts HTTP/2 cleartext on
port 8080, and `publish.sh` enables Cloud Run’s end-to-end HTTP/2 setting. This
allows the larger interaction recording to download completely rather than
relying on a non-streaming HTTP/1 response. See [Cloud Run HTTP/2 configuration](https://docs.cloud.google.com/run/docs/configuring/http2)
and [response limits](https://docs.cloud.google.com/run/quotas).

The v0.2.0 film is 207.500 seconds, 1920×1080 at 30 fps, and 81,660,839 bytes. It
uses a continuous capture of the deployed app, retains the performed typing and
clicks at 1×, and removes inactive time. A single slow focus emphasizes fresh
confirmations. The fictional sample includes live Qloo discovery, exact-copy
approval, withdrawal, new confirmations, inspections and recorded completion.

Before deployment, the pinned Nginx container passed a local h2c full-file
download/hash check, first/last byte ranges, caption/poster MIME and content
checks, and rejection of private artifact paths. Repeat these checks on the
public service, then check native playback, seeking and optional captions in a
browser. The dated [release verification](../../../docs/RELEASE-VERIFICATION.md)
records the published checks.
