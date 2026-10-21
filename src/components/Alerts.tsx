export function Alerts({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-notice" role="status">{notice}</div>}
    </>
  );
}
