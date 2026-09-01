import { APP_NAME } from "@/lib/branding";

export default function Home() {
  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        background: "var(--background)",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: "clamp(2rem, 6vw, 3.5rem)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: "var(--foreground)",
        }}
      >
        {APP_NAME}
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: "0.95rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        coming online
      </p>
    </main>
  );
}
