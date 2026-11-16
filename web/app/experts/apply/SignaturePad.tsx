"use client";

import { useEffect, useRef, useState } from "react";

const W = 600;
const H = 200;

/** A box to sign in with a mouse, a finger or a pen. Gives back a small transparent PNG (as a data URL) or "" when empty. */
export function SignaturePad({ onChange, disabled = false }: { onChange: (dataUrl: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [inked, setInked] = useState(false);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1a1a";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    last.current = p;
    const ctx = ref.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2); // a tap leaves a dot
    ctx.fillStyle = "#1a1a1a";
    ctx.fill();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const p = point(e);
    const ctx = ref.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    setInked(true);
    onChange(ref.current!.toDataURL("image/png"));
  };
  const clear = () => {
    ref.current!.getContext("2d")!.clearRect(0, 0, W, H);
    setInked(false);
    onChange("");
  };

  return (
    <div className="ex-pad">
      <canvas
        ref={ref}
        width={W}
        height={H}
        className={`ex-canvas${disabled ? " off" : ""}`}
        role="img"
        aria-label="Signature box. Draw your signature with a mouse, a finger or a pen."
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div className="ex-pad-foot">
        <span className="ex-pad-hint">{disabled ? "Not needed: your typed name is your signature." : inked ? "Looks good. You can clear it and try again." : "Sign here with your mouse or finger."}</span>
        <button type="button" className="btn btn-light btn-sm" onClick={clear} disabled={disabled || !inked}>
          Clear
        </button>
      </div>
    </div>
  );
}
