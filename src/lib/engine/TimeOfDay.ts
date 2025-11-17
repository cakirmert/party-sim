export class TimeOfDay {
  minute: number; // 0..1439
  dayOfWeek: number = 0; // 0..6
  constructor(startMinute = 360) { this.minute = startMinute % 1440; } // 06:00
  advance(mins: number) { this.minute = (this.minute + mins) % 1440; }
  set(mins: number) { this.minute = mins % 1440; }
  fmt(): string {
    const h = Math.floor(this.minute / 60);
    const m = this.minute % 60;
    const pad = (n:number)=> n<10?`0${n}`:`${n}`;
    return `${pad(h)}:${pad(m)}`;
  }
}
