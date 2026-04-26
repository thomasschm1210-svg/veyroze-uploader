const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const GRAY   = '\x1b[90m';

function ts() {
  return GRAY + new Date().toTimeString().slice(0, 8) + RESET;
}

export const log = {
  info:    (msg) => console.log(`${ts()}  ${msg}`),
  success: (msg) => console.log(`${ts()}  ${GREEN}✓${RESET} ${msg}`),
  warn:    (msg) => console.log(`${ts()}  ${YELLOW}⚠${RESET}  ${msg}`),
  error:   (msg) => console.log(`${ts()}  ${RED}✗${RESET} ${msg}`),
  step:    (msg) => console.log(`${ts()}  ${CYAN}→${RESET} ${msg}`),
  dim:     (msg) => console.log(`${ts()}  ${DIM}${msg}${RESET}`),
  divider: ()    => console.log(GRAY + '─'.repeat(52) + RESET),
  header:  (msg) => console.log(`\n${BOLD}${CYAN}${msg}${RESET}`),
};
