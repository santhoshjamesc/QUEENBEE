/** Splits a byte stream into JSON lines and parses them. Tolerates partial chunks and non-JSON lines. */
export class LineParser {
  private buf = ''
  constructor(private onJson: (obj: any) => void, private onBad: (line: string) => void = () => {}) {}

  push(chunk: string): void {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (line) this.parse(line)
    }
  }

  flush(): void {
    const line = this.buf.trim()
    this.buf = ''
    if (line) this.parse(line)
  }

  private parse(line: string): void {
    try {
      this.onJson(JSON.parse(line))
    } catch {
      this.onBad(line)
    }
  }
}
