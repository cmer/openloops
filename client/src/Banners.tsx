export type Banner = { id: number; kind: "ok" | "queued" | "error"; text: string };

const LABEL = { ok: "Sent", queued: "Queued", error: "Not saved" } as const;

/** Bottom-centre stack. App removes each banner after about 4s. */
export function Banners({ banners }: { banners: Banner[] }) {
  return (
    <div className="ol-banners" aria-live="polite">
      {banners.map((banner) => (
        <div key={banner.id} className={`ol-banner ol-banner--${banner.kind}`} role={banner.kind === "error" ? "alert" : "status"}>
          <span className="ol-label">{LABEL[banner.kind]}</span>
          <span>{banner.text}</span>
        </div>
      ))}
    </div>
  );
}
