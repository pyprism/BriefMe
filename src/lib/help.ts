export const ORIGINS_VALUE = 'chrome-extension://*,moz-extension://*,safari-web-extension://*';

export const ORIGINS_COMMANDS: { label: string; command: string }[] = [
  {
    label: 'macOS (Ollama app)',
    command: `launchctl setenv OLLAMA_ORIGINS "${ORIGINS_VALUE}"\n# then quit and reopen Ollama`,
  },
  {
    label: 'Linux (systemd)',
    command: `sudo systemctl edit ollama.service\n# add:\n[Service]\nEnvironment="OLLAMA_ORIGINS=${ORIGINS_VALUE}"\n# then:\nsudo systemctl daemon-reload && sudo systemctl restart ollama`,
  },
  {
    label: 'Windows (PowerShell)',
    command: `setx OLLAMA_ORIGINS "${ORIGINS_VALUE}"\n# then quit and restart Ollama from the tray`,
  },
  {
    label: 'Docker',
    command: `docker run -d -p 11434:11434 -e OLLAMA_ORIGINS="${ORIGINS_VALUE}" -v ollama:/root/.ollama ollama/ollama`,
  },
  {
    label: 'Terminal',
    command: `OLLAMA_ORIGINS="${ORIGINS_VALUE}" ollama serve`,
  },
];
