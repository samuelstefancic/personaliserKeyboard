import defaultsDeep from 'lodash.defaultsdeep';
import type {StoreData} from '../types/types';

export class Store {
  store: StoreData;
  readonly persistedStore: Partial<StoreData> | undefined;
  constructor(defaults: StoreData) {
    const store = localStorage.getItem('via-app-store');
    const parsedStore = store ? JSON.parse(store) : undefined;
    this.persistedStore = parsedStore
      ? structuredClone(parsedStore)
      : undefined;
    this.store = this.persistedStore
      ? defaultsDeep({}, parsedStore, defaults)
      : defaults;
  }
  get<K extends keyof StoreData>(key: K): StoreData[K] {
    return this.store[key];
  }
  set<K extends keyof StoreData>(key: K, value: StoreData[K]) {
    const newStoreData = {
      ...this.store,
      [key]: {...value},
    };
    this.store = newStoreData;
    // This ends up triggering an error about .get proxy failing for JSON.stringify
    // because it's inside an async function, so we delay it out of that event loop
    setTimeout(() => {
      localStorage.setItem('via-app-store', JSON.stringify(newStoreData));
    }, 0);
  }
}
