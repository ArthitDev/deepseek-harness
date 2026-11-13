# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Shield Break fork

This repository is the **Shield Break** fork of DeepSeek Harness, tracking upstream `0.2.2-rc.1` with the full upstream feature set plus the Shield Break security-testing capabilities: the pentest control plane (durable runs, supervisor/executor episodes, deterministic recon), target-scope and run-budget guards, saved SSH machines, runtime package invariants, team-based agent swarms, the Exa and Perplexity web-search providers, and the Shield Break terminal UI with Kali WSL integration.

The embedded proxies (ZCode Direct, Antigravity, and SB transport) run on **Bun**; the Harness Host runs on **Node.js**. Make Bun available on the service account's `PATH`. See the [proxy runtime requirements](packages/llm/proxy-server/README.md) and [Bun migration guide](docs/upgrade-guide/v0.2.2-rc.1/embedded-proxy-bun/guide.md).

Use Shield Break only for lawful purposes and authorized security testing. Users are responsible for their use and misuse; the project's liability disclaimer applies only to the extent permitted by law. Read the [lawful-use and liability notice](SAFETY.md#lawful-use-and-user-responsibility).

Before using the security-testing features, review the [pentest lab authorization template](docs/pentest-lab-authorization-template.md) and the [Kali WSL guide](docs/user/guide/kali-wsl.md).

### Jev evidence review

Optional Jev integration gives Web, TUI and headless agents twelve semantic tools through the existing MCP bridge. Use it to classify and rank recon observations, verify findings against evidence, and review proposed changes. Jev does not replace deterministic scans, target-scope guards or VPN traffic checks.

The [Jev setup and usage guide](docs/user/guide/jev.md) describes the pinned Linux runtime, service-account credentials, shared profile configuration, suggested workflow and a real-call verification prompt. Jev is enabled by deployment configuration; a fresh checkout does not install it or inherit a server's private setup. Calls consume the configured TypeSafe account's quota and may incur charges. Semantic tools are separate from browser/native automation routing.

<a id="server-workspace-and-vpn"></a>
### Server workspace and VPN

VPN-only Internet access is an administrator-managed Linux deployment policy. A fresh checkout does not create the VPN namespace, firewall, systemd services or Kali broker. The VPN status indicator reports cached traffic verification; it does not enforce routing or block traffic when the tunnel fails.

On an already provisioned VPN server, apply the same filesystem policy to the Web service and the TUI launcher's transient services. Normal workspace access can use `ProtectSystem=no`, `ProtectHome=no` and an empty `ReadWritePaths=` override. Retain the non-root service identity, empty capabilities, `NoNewPrivileges=yes`, VPN network namespace, private host-control sockets and restricted Kali broker. Keep launchers, firewall rules and service policy administrator-owned and unwritable by Harness. The application settings `danger-full-access` and approval `never` do not override Linux permissions or read-only mounts; broader filesystem access follows the service account's existing permissions.

Configure Web and TUI with the same absolute, service-writable [recon evidence directory](packages/pentest/recon-engine/README.md#use-this-package), such as `/var/lib/dsh-harness/.dsh/recon`. Preserve the other fields when replacing a plugin's configuration. A different `HOME` or `DSH_HOME` can select different private configuration files. Source updates alone do not install these host settings or migrate existing evidence.

Before activation, back up affected host/profile files with their ownership and modes, wait for active turns/jobs to finish, and verify file creation and evidence reads as the actual service account. Verify real IPv4/IPv6 VPN egress for Harness and Kali, then confirm that a direct uplink connection is rejected by the firewall; interface binding errors alone are not evidence of rejection. Restore the backup if checks fail. Restart only the affected Web service and reopen existing TUI sessions to receive systemd mount-policy changes. Keep the live VPN running during these checks; a full tunnel-loss drill requires a separate maintenance window.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
