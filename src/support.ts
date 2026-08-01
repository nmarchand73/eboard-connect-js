export function isBleSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.bluetooth?.requestDevice);
}

export function isHidSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.hid?.requestDevice);
}
