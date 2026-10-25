import { useEffect, useRef, useState } from "react"

export function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: string
}) {
  return <span className={`badge ${tone}`}>{children}</span>
}

/** "Today, 11:50 PM" or "10/24/2026, 11:50 PM". */
export function formatWhen(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const today = new Date().toDateString() === d.toDateString()
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return today ? `Today, ${time}` : `${d.toLocaleDateString()}, ${time}`
}

export const FRAME = { width: 1280, height: 800 }

/** A live view of a prototype version, rendered at its real size (desktop by default) and scaled down to fit its column. */
export function VersionPreview({ url, title, frame = FRAME }: { url: string; title: string; frame?: { width: number; height: number } }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(Math.min(1, el.clientWidth / frame.width))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [frame.width])
  return (
    <div className="subject version-preview">
      <div className="subject-top">
        <i />
        <i />
        <i />
        <b>{new URL(url).pathname}</b>
        <a href={url} target="_blank" rel="noreferrer">
          Open ↗
        </a>
      </div>
      <div className="frame-box" ref={box} style={{ height: frame.height * scale }}>
        <iframe
          src={url}
          title={title}
          sandbox="allow-scripts allow-same-origin allow-forms"
          style={{ width: frame.width, height: frame.height, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  )
}
