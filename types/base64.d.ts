interface Uint8Array {
  toBase64(): string
}

interface Uint8ArrayConstructor {
  fromBase64(base64: string): Uint8Array
}

declare const crypto: {
  getRandomValues<T extends Uint8Array>(array: T): T
}
