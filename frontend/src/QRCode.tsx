import { createEffect, onCleanup } from "solid-js";
import QRCode from "qrcode";

type QRCodeCanvasProps = {
  value: string;
  label: string;
};

export default function QRCodeCanvas(props: QRCodeCanvasProps) {
  let canvas: HTMLCanvasElement | undefined;

  createEffect(() => {
    if (!canvas || !props.value) return;

    let disposed = false;
    QRCode.toCanvas(canvas, props.value, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 6,
      color: {
        dark: "#080808",
        light: "#ffffff",
      },
    }).catch(() => {
      if (disposed || !canvas) return;
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    });

    onCleanup(() => {
      disposed = true;
    });
  });

  return (
    <div class="qr-card">
      <canvas ref={canvas} aria-label={props.label} />
    </div>
  );
}
