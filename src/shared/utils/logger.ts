export const logger = {
    info: (message: string) => {
        console.log(`[\x1b[32mINFO\x1b[0m] [${new Date().toISOString()}] ${message}`);
    },
    warn: (message: string) => {
        console.warn(`[\x1b[33mWARN\x1b[0m] [${new Date().toISOString()}] ${message}`);
    },
    error: (message: string) => {
        console.error(`[\x1b[31mERROR\x1b[0m] [${new Date().toISOString()}] ${message}`);
    },
    debug: (message: string) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[\x1b[36mDEBUG\x1b[0m] [${new Date().toISOString()}] ${message}`);
        }
    }
};
