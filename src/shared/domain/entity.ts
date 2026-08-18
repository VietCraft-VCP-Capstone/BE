export abstract class Entity<T> {
    protected readonly _id: T;
    constructor(id: T) {
        this._id = id;
    }
    get id(): T { return this._id; }
    equals(object?: Entity<T>): boolean {
        if (object == null || object === undefined) return false;
        if (this === object) return true;
        return this._id === object._id;
    }
}
