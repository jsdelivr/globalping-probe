export class AsyncLookupMap<Key, Value> {
	private readonly values = new Map<Key, Value>();
	private readonly pending = new Map<Key, Promise<void>>();

	constructor (private readonly lookup: (key: Key) => Promise<Value | undefined>) {}

	add (key: Key): void {
		if (this.values.has(key) || this.pending.has(key)) {
			return;
		}

		let lookup: Promise<Value | undefined>;

		try {
			lookup = this.lookup(key);
		} catch (error: unknown) {
			lookup = Promise.reject(error instanceof Error ? error : new Error(String(error)));
		}

		const pending = lookup
			.then((value) => {
				if (value !== undefined && !this.values.has(key)) {
					this.values.set(key, value);
				}
			})
			.catch(() => {});

		this.pending.set(key, pending);
	}

	set (key: Key, value: Value): void {
		this.values.set(key, value);
	}

	get (key: Key): Value | undefined {
		return this.values.get(key);
	}

	async wait (): Promise<void> {
		await Promise.all(this.pending.values());
	}
}
