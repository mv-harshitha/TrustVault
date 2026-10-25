export function sessionIdentity(session) {
  if (!session?.user?.id || !session?.company?.id || !session?.role) return null;
  return JSON.stringify([
    String(session.user.id),
    String(session.company.id),
    String(session.role)
  ]);
}

export function sessionChanged(previous, next) {
  return sessionIdentity(previous) !== sessionIdentity(next);
}

export function watchSession({ loadSession, onSession, onChecking, windowTarget, documentTarget }) {
  let requestId = 0;
  let stopped = false;

  async function revalidate() {
    const currentRequest = ++requestId;
    onChecking(true);

    let session = false;
    try {
      session = await loadSession();
    } catch {
      // Fail closed when the session cannot be verified.
    }

    if (stopped || currentRequest !== requestId) return null;
    onSession(session);
    onChecking(false);
    return session;
  }

  const handleFocus = () => { void revalidate(); };
  const handleVisibilityChange = () => {
    if (documentTarget.visibilityState === "visible") void revalidate();
  };

  windowTarget.addEventListener("focus", handleFocus);
  documentTarget.addEventListener("visibilitychange", handleVisibilityChange);
  void revalidate();

  return {
    revalidate,
    stop() {
      stopped = true;
      requestId += 1;
      windowTarget.removeEventListener("focus", handleFocus);
      documentTarget.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  };
}
