// The program macOS holds responsible for what AgentOS runs on a Mac.
//
// macOS asks its privacy questions (Accessibility, Automation, the
// Documents folder, ...) in the name of the program that started whatever
// asks. Started by launchd as a bare `node`, that was "node", with a path
// into Homebrew. The service starts under this program instead, inside a
// small app bundle (Info.plist beside this file), so the questions and
// System Settings say AgentOS. What it runs keeps that name for as long
// as it lives, also after this program has gone.
//
//   agentos-host -- command [arguments]   run it, pass signals on, end as it ends
//   agentos-host --selftest               0 when it can start a program
//
// It reads nothing, opens nothing and decides nothing: allowing AgentOS
// something in System Settings stays the person's own choice.
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

static volatile sig_atomic_t child = 0;
static const int PASSED_ON[] = {SIGTERM, SIGINT, SIGHUP, SIGQUIT, SIGUSR1, SIGUSR2};
#define N_PASSED (sizeof PASSED_ON / sizeof *PASSED_ON)

static void pass_on(int sig) {
  if (child > 0) kill((pid_t)child, sig);
}

static int run(char *const argv[]) {
  // Held back until the child exists, so none is lost in between
  sigset_t held, before;
  sigemptyset(&held);
  for (size_t i = 0; i < N_PASSED; i++) sigaddset(&held, PASSED_ON[i]);
  sigprocmask(SIG_BLOCK, &held, &before);

  struct sigaction act;
  memset(&act, 0, sizeof act);
  act.sa_handler = pass_on;
  sigemptyset(&act.sa_mask);
  act.sa_flags = SA_RESTART;
  for (size_t i = 0; i < N_PASSED; i++) sigaction(PASSED_ON[i], &act, NULL);

  // The child starts with the signals as this program found them
  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  posix_spawnattr_setsigmask(&attr, &before);
  posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETSIGMASK);
  pid_t pid = 0;
  int err = posix_spawnp(&pid, argv[0], NULL, &attr, argv, environ);
  posix_spawnattr_destroy(&attr);
  if (err != 0) {
    fprintf(stderr, "agentos-host: %s: %s\n", argv[0], strerror(err));
    return 127;
  }
  child = pid;
  sigprocmask(SIG_SETMASK, &before, NULL);

  int status = 0;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) return 125;
  }
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return WEXITSTATUS(status);
}

int main(int argc, char *argv[]) {
  if (argc == 2 && strcmp(argv[1], "--selftest") == 0) {
    char *const probe[] = {"/usr/bin/true", NULL};
    return run(probe);
  }
  if (argc >= 3 && strcmp(argv[1], "--") == 0) return run(argv + 2);
  fprintf(stderr, "usage: agentos-host -- command [arguments]\n");
  return 2;
}
