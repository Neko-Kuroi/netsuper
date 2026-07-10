export class Semaphore {
    private max: number;
    private running: number;
    private queue: (() => void)[];

    constructor(max: number) {
        this.max = max;
        this.running = 0;
        this.queue = [];
    }

    async acquire(): Promise<void> {
        return new Promise<void>(resolve => {
            if (this.running < this.max) {
                this.running++;
                resolve();
            } else {
                this.queue.push(resolve);
            }
        });
    }

    release(): void {
        this.running--;
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) {
                this.running++;
                next();
            }
        }
    }
}