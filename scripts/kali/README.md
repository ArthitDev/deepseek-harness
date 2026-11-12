---
description: "Build and verify the Kali CLI image for restricted Linux Docker deployments and server migrations."
---
# Kali CLI image

English | [中文](README.zh.md)

## Summary

Build the Kali toolchain before starting a restricted Harness container. The image supplies the packages in [packages.txt](packages.txt), Rust, Go, Python, Node.js and uv without copying a live server's filesystem. Windows keeps its existing `kali-linux` WSL backend; this recipe provisions Linux Docker backends.

## Table of Contents

- [Build and verify](#build-and-verify)
- [Deployment and migration](#deployment-and-migration)
- [Runtime package operations](#runtime-package-operations)
- [Implementation](#implementation)
- [Dev Note](#dev-note)

<a id="build-and-verify"></a>

## Build and verify

Use a trusted checkout, Docker with a Linux engine, and Node.js. Run from the repository root. The build needs signed Kali repository access over IPv4 and enough disk space for compiler and tool packages.

```sh
docker build -t dsh-kali-cli:portable-20261112 scripts/kali
node scripts/kali/verify.mjs dsh-kali-cli:portable-20261112
```

The verifier creates disposable containers without networking or host mounts. It requires a clean package database and working tool executables under `cap-drop ALL`, `NET_RAW`, `no-new-privileges`, and seccomp filtering. It also checks that incomplete packages, missing APT configuration, incorrect cache ownership, and disabled seccomp are rejected. Failed or timed-out checks fail the command and remove their test containers. Seccomp mode alone does not identify the filter policy; the deployment must retain its approved profile.

For an online readiness check, run `/usr/local/libexec/dsh-kali/check.sh online` through the deployment's configured Kali backend. This updates package indexes with strict error reporting and downloads the small `hello` package without installing it. The operator must verify the deployment's VPN route and broker separately; an offline image check cannot establish either.

<a id="deployment-and-migration"></a>

## Deployment and migration

Use the verified image as the existing Kali service's `image`. Keep the deployment's mounts, root user, `network_mode: none`, `cap_drop: [ALL]`, `cap_add: [NET_RAW]`, and `security_opt: [no-new-privileges:true]`. Its trusted host lifecycle owns the VPN network attachment and broker identity. This directory does not install that deployment-specific lifecycle or grant Docker access to the agent.

Before replacing a running service, save its Compose configuration and previous image identifier, check for active jobs, and use its network lifecycle to recreate the container and refresh the broker's identity. Verify the online checker through the actual Harness execution identity, then test broker access and VPN failure behavior. If any check fails, restore the previous image and configuration through the same lifecycle. A plain Compose restart cannot safely replace a container whose network namespace is managed externally.

Move the verified image through an authenticated registry by digest, or export/import it as a Docker image artifact and compare its image identifier on both servers. Transfer private configuration, mounts and data separately. Do not use a live container snapshot as the build recipe. The pinned base images make build inputs explicit, but Kali Rolling package versions change; rebuilding later does not guarantee identical packages. The image stores installed versions at `/usr/local/share/dsh-kali/versions.tsv`. Transfer the built artifact when exact versions are required.

<a id="runtime-package-operations"></a>

## Runtime package operations

APT runs download workers as container root because the runtime cannot switch to `_apt`. Root-owned download directories allow update and download operations without adding `SETUID`, `SETGID`, `CHOWN`, or `FOWNER`. Download workers can write the container's writable mounts; keep private host files outside those mounts and keep package sources trusted. APT still verifies repository signatures and HTTPS certificates.

The image configures all declared packages during build, including packages whose maintainer scripts need ownership changes. A new package or upgrade can require capabilities unavailable at runtime: add it to `packages.txt`, rebuild, and verify before deployment. Arbitrary runtime `apt install` is not guaranteed. Do not bypass signature verification, add runtime capabilities, or loop through manual dependency downloads to repair an image. If an online update fails, diagnose DNS, mirror reachability and VPN policy; stale indexes do not count as success.

<a id="implementation"></a>

## Implementation

[Dockerfile](Dockerfile) pins official Kali and uv images. [prepare-runtime.sh](prepare-runtime.sh) prepares APT directories and Redis ownership metadata during build, removes nmap file capabilities that conflict with the runtime bounding set, and exposes Kali's `httpx-toolkit` as `httpx`. Account names resolve inside the image rather than using host-specific numeric IDs.

[check.sh](check.sh) validates the deployed filesystem and effective runtime restrictions. It checks command availability and starts nmap and the language runtimes; it does not execute every security tool or scan any target. [verify.mjs](verify.mjs) owns its randomly named test containers and checks failure diagnostics as well as exit status.

<a id="dev-note"></a>

## Dev Note

None.
