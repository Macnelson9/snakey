// Placeholder shell. The dot-matrix PWA + render loop on the shared engine is a
// later milestone (CLAUDE.md NEXT step 4). The score-integrity backend
// (/session, /settle) is wired and tested under src/lib and src/app/api.
export default function Home() {
  return (
    <main style={{ fontFamily: "monospace", padding: 24 }}>
      <h1>nokiadot</h1>
      <p>backend: /session + /settle live. game shell coming next.</p>
    </main>
  );
}
