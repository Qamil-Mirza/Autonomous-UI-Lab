import { InMemoryStore } from "../src/store";
import { runStoreContract } from "./store-contract";

runStoreContract("InMemoryStore", async () => ({ store: new InMemoryStore() }));
