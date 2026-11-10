# Safety

English | [中文](SAFETY.zh.md)

## Experimental status

DeepSeek Harness is experimental developer-preview software. It has not undergone a security audit and must not be treated as secure or production-ready.

The project can execute model-generated code and commands, load third-party plugins, and access the network, processes, credentials, and files made available to it. Incorrect model output, defects, misconfiguration, malicious input, or untrusted plugins may damage the host computer, modify or delete files, disclose data or credentials, or cause other unintended effects.

## Sandbox limitations

Sandboxing, approval prompts, and permission controls can reduce risk, but they do not guarantee isolation or prevent damage. Even correctly enforced restrictions cannot protect resources that the project is allowed to access.

Do not rely on DeepSeek Harness as the sole security control for untrusted workloads.

## Responsible use

- Run the project with the least privileges and access required.
- Prefer a disposable virtual machine, container, or dedicated environment.
- Keep backups of files that the project can access.
- Do not expose sensitive credentials or data unless you accept the risk.
- Review plugins, configuration, and proposed commands before allowing them to run.

<a id="lawful-use-and-user-responsibility"></a>

## Lawful use and user responsibility

DeepSeek Harness, including this Shield Break fork, is intended for lawful development, research, and authorized security testing. Only test systems you own or have explicit authorization to test from the owner or another party legally entitled to grant it. Stay within the authorized scope and comply with applicable laws and third-party service terms.

Users are responsible for obtaining authorization, choosing targets, providing instructions, and the actions and effects of agents, tools, plugins, scripts, and subagents they run, including automated or delegated actions. Users are responsible for their misuse and any resulting harm or legal consequences, subject to applicable law.

The project's authors, maintainers, contributors, and copyright holders do not authorize or endorse unlawful access, attacks, data theft, or other misuse. Access to the software does not grant permission to access third-party systems.

## No warranty or liability

Use DeepSeek Harness, including this Shield Break fork, at your own risk. The software is provided without warranty under the [MIT License](LICENSE). To the maximum extent permitted by applicable law, the authors, maintainers, contributors, and copyright holders are not liable for claims, damages, or other liability arising from use or misuse of the project, including damage to computers, loss or disclosure of data, loss of files, or other harm. This notice does not exclude or limit liability that applicable law does not allow to be excluded or limited.
