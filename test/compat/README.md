# Native command compatibility tests

This suite verifies that the production ping, traceroute, MTR, and DNS command classes understand output from the current Debian-native executables. It complements the mocked unit and snapshot tests; it is not a replacement for them.

## Running the suite

The tests require Linux and the same packages installed by CI:

```sh
apt-get update
apt-get install --no-install-recommends -y git ca-certificates expect iputils-ping traceroute dnsutils mtr-tiny
NODE_ENV=test GP_TEST_ALLOW_PRIVATE_TARGETS=1 npm run test:compat
```

To reproduce a CI image exactly, run it in the floating official image. Mount the repository at `/workspace` and run the command from there:

```sh
docker run --rm -it -v "$PWD:/workspace" -w /workspace node:22-slim bash -lc \
  'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y git ca-certificates expect iputils-ping traceroute dnsutils mtr-tiny && npm ci && NODE_ENV=test GP_TEST_ALLOW_PRIVATE_TARGETS=1 npm run test:compat'
```

## Scope and safety

The suite uses loopback for ping, traceroute, and MTR, and starts its own UDP/TCP DNS server for DNS responses. It covers IPv4 and IPv6 loopback targets (including an expanded IPv6 spelling), real command name-resolution failure behavior, and DNS A/AAAA responses over IPv4 and IPv6 resolver transports using UDP and TCP. It also exercises NXDOMAIN, SERVFAIL, refused connections, and silent DNS timeouts without accessing public services.

Loopback is normally rejected by the probe's private-target policy. Compatibility tests may use it only when both `NODE_ENV=test` and `GP_TEST_ALLOW_PRIVATE_TARGETS=1` are set. The first gate confines the exception to the test runtime, while the explicit flag prevents ordinary tests from silently enabling private targets. Production behavior, resolver redaction, and private ASN lookup suppression remain unchanged.

Topology-dependent cases remain deterministic fixtures: multi-hop routes, unusual interface and link-local-zone output, and process-deadline edge cases require privileged network setup or external infrastructure to reproduce reliably. HTTP is also outside this suite because it uses Node/Undici rather than a native networking executable.

## CI environment

The `commandtest` workflow job runs the suite in the official floating `node:18-slim`, `node:20-slim`, `node:22-slim`, `node:24-slim`, and `node:26-slim` images. Those tags intentionally float: the purpose is to detect parser compatibility with each supported Node major's current Debian base image and native Debian package versions. Each job logs `/etc/os-release`, Node/npm, Debian package versions, and executable versions so a failure can be tied to its exact environment.
