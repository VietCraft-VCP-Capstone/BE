export const logger = {
    info: (message: any, ...args: any[]) => {
        console.log(`[\x1b[32mINFO\x1b[0m] [${new Date().toISOString()}] ${message}`, ...args);
    },
    warn: (message: any, ...args: any[]) => {
        console.warn(`[\x1b[33mWARN\x1b[0m] [${new Date().toISOString()}] ${message}`, ...args);
    },
    error: (message: any, ...args: any[]) => {
        console.error(`[\x1b[31mERROR\x1b[0m] [${new Date().toISOString()}] ${message}`, ...args);
    },
    debug: (message: any, ...args: any[]) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[\x1b[36mDEBUG\x1b[0m] [${new Date().toISOString()}] ${message}`, ...args);
        }
    }
};
