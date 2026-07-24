export type CompletionShell = "bash" | "zsh" | "fish";

const commands = ["lint", "build", "inspect", "completion", "help", "version"];
const commonOptions = ["--config", "--release-profile", "--format", "--help"];

function bashCompletion(): string {
	return `# bash completion for s11t
_s11t_completion() {
  local current previous command
  COMPREPLY=()
  current="\${COMP_WORDS[COMP_CWORD]}"
  previous="\${COMP_WORDS[COMP_CWORD-1]}"
  command="\${COMP_WORDS[1]}"

  if [[ "\${previous}" == "completion" ]]; then
    COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${current}") )
    return
  fi
  if [[ "\${COMP_CWORD}" -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commands.join(" ")} --help --version" -- "\${current}") )
    return
  fi

  case "\${command}" in
    lint) COMPREPLY=( $(compgen -W "${commonOptions.join(" ")}" -- "\${current}") ) ;;
    build) COMPREPLY=( $(compgen -W "${[...commonOptions, "--check"].join(" ")}" -- "\${current}") ) ;;
    inspect) COMPREPLY=( $(compgen -W "${[
			...commonOptions,
			"--resolved",
			"--locale",
			"--coverage",
			"--fallback-locale",
		].join(" ")}" -- "\${current}") ) ;;
  esac
}
complete -F _s11t_completion s11t
`;
}

function zshCompletion(): string {
	return `#compdef s11t

_s11t() {
  local -a commands
  commands=(
    'lint:validate authored contexts'
    'build:compile artifacts and generated types'
    'inspect:inspect one context or locale coverage'
    'completion:emit shell completion'
    'help:show command help'
    'version:show the CLI version'
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "\${words[2]}" in
    lint)
      _arguments '--config[config path]:path:_files' '--release-profile[release profile]:profile:' '--format[output format]:(human json)' '--help[show help]'
      ;;
    build)
      _arguments '--config[config path]:path:_files' '--release-profile[release profile]:profile:' '--format[output format]:(human json)' '--check[check generated outputs]' '--help[show help]'
      ;;
    inspect)
      _arguments '1:context key:' '--config[config path]:path:_files' '--release-profile[release profile]:profile:' '--format[output format]:(human json)' '--resolved[show resolved policy]' '--locale[instruction locale]:locale:' '--coverage[show locale coverage]' '*--fallback-locale[fallback locale]:locale:' '--help[show help]'
      ;;
    completion)
      _arguments '1:shell:(bash zsh fish)'
      ;;
  esac
}

_s11t "$@"
`;
}

function fishCompletion(): string {
	return `# fish completion for s11t
complete -c s11t -f
complete -c s11t -n '__fish_use_subcommand' -a lint -d 'Validate authored contexts'
complete -c s11t -n '__fish_use_subcommand' -a build -d 'Compile artifacts and generated types'
complete -c s11t -n '__fish_use_subcommand' -a inspect -d 'Inspect a context or locale coverage'
complete -c s11t -n '__fish_use_subcommand' -a completion -d 'Emit shell completion'
complete -c s11t -n '__fish_use_subcommand' -a help -d 'Show command help'
complete -c s11t -n '__fish_use_subcommand' -a version -d 'Show the CLI version'
complete -c s11t -l help -d 'Show help'
complete -c s11t -l version -d 'Show the CLI version'
complete -c s11t -n '__fish_seen_subcommand_from lint build inspect' -l config -r -d 'Config path'
complete -c s11t -n '__fish_seen_subcommand_from lint build inspect' -l release-profile -r -d 'Release profile'
complete -c s11t -n '__fish_seen_subcommand_from lint build inspect' -l format -r -a 'human json' -d 'Output format'
complete -c s11t -n '__fish_seen_subcommand_from build' -l check -d 'Check generated outputs'
complete -c s11t -n '__fish_seen_subcommand_from inspect' -l resolved -d 'Show resolved policy'
complete -c s11t -n '__fish_seen_subcommand_from inspect' -l locale -r -d 'Instruction locale'
complete -c s11t -n '__fish_seen_subcommand_from inspect' -l coverage -d 'Show locale coverage'
complete -c s11t -n '__fish_seen_subcommand_from inspect' -l fallback-locale -r -d 'Fallback locale'
complete -c s11t -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'
`;
}

export function completionScript(shell: CompletionShell): string {
	if (shell === "bash") return bashCompletion();
	if (shell === "zsh") return zshCompletion();
	return fishCompletion();
}
