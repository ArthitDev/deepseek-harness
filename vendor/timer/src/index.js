import { Service } from '@deepseek-ai/cordis';
/** Disposable timer helpers mixed into Cordis contexts. */
export class TimerService extends Service {
    constructor(ctx) {
        super(ctx, 'timer');
        ctx.mixin('timer', ['timeout', 'interval', 'throttle', 'debounce', 'setTimeout', 'setInterval']);
    }
    /** @deprecated use `ctx.timeout()` instead */
    setTimeout(callback, delay) {
        return this.timeout(callback, delay);
    }
    /** @deprecated use `ctx.interval()` instead */
    setInterval(callback, delay) {
        return this.interval(callback, delay);
    }
    timeout(...args) {
        const callback = typeof args[0] === 'function' ? args.shift() : undefined;
        const delay = args[0];
        if (callback) {
            const dispose = this.ctx.effect(() => {
                const timer = setTimeout(() => {
                    dispose();
                    callback();
                }, delay);
                return () => clearTimeout(timer);
            }, 'ctx.timeout()');
            return dispose;
        }
        else {
            const { promise, resolve, reject } = Promise.withResolvers();
            const dispose = this.ctx.effect(() => {
                const timer = setTimeout(resolve, delay);
                return () => {
                    clearTimeout(timer);
                    reject(new Error('Context has been disposed'));
                };
            }, 'ctx.timeout()');
            return promise.finally(dispose);
        }
    }
    interval(...args) {
        const callback = typeof args[0] === 'function' ? args.shift() : undefined;
        const delay = args[0];
        if (callback) {
            return this.ctx.effect(() => {
                const timer = setInterval(callback, delay);
                return () => clearInterval(timer);
            }, 'ctx.interval()');
        }
        else {
            let done;
            const nextTasks = [];
            const dispose = this.ctx.effect(() => {
                const timer = setInterval(() => {
                    nextTasks.shift()?.resolve({ done: false, value: undefined });
                }, delay);
                return () => {
                    clearInterval(timer);
                    if (done)
                        return;
                    done = { kind: 'throw', reason: new Error('Context has been disposed') };
                    for (const task of nextTasks.splice(0))
                        task.reject(done.reason);
                };
            }, 'ctx.interval()');
            return {
                next: () => {
                    if (!done) {
                        const task = Promise.withResolvers();
                        nextTasks.push(task);
                        return task.promise;
                    }
                    if (done.kind === 'return')
                        return Promise.resolve({ done: true, value: done.value });
                    return Promise.reject(done.reason);
                },
                return: (value) => {
                    if (!done)
                        done = { kind: 'return', value };
                    for (const task of nextTasks.splice(0))
                        task.resolve({ done: true, value });
                    dispose();
                    return Promise.resolve({ done: true, value });
                },
                throw: (reason) => {
                    if (!done)
                        done = { kind: 'throw', reason };
                    for (const task of nextTasks.splice(0))
                        task.reject(reason);
                    dispose();
                    return Promise.resolve({ done: true, value: undefined });
                },
                [Symbol.asyncIterator]() {
                    return this;
                },
            };
        }
    }
    _schedule(label, trigger) {
        let timer;
        let isDisposed = false;
        const dispose = this.ctx.effect(() => () => {
            isDisposed = true;
            clearTimeout(timer);
            timer = undefined;
        }, label);
        const wrapper = (...args) => {
            if (isDisposed)
                return;
            clearTimeout(timer);
            timer = trigger(args);
        };
        wrapper.dispose = dispose;
        return wrapper;
    }
    /** Return a throttled function whose timer is disposed with the current fiber. */
    throttle(callback, delay, noTrailing) {
        let lastCall = -Infinity;
        const execute = (...args) => {
            lastCall = Date.now();
            callback(...args);
        };
        return this._schedule('ctx.throttle()', (args) => {
            const now = Date.now();
            const remaining = delay - now + lastCall;
            if (remaining <= 0) {
                execute(...args);
            }
            else if (!noTrailing) {
                return setTimeout(execute, remaining, ...args);
            }
        });
    }
    /** Return a debounced function whose timer is disposed with the current fiber. */
    debounce(callback, delay) {
        return this._schedule('ctx.debounce()', (args) => {
            return setTimeout(callback, delay, ...args);
        });
    }
}
export default TimerService;
//# sourceMappingURL=index.js.map