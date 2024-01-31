import { RSPEngine, RDFStream } from "rsp-js";
import { QueryEngine } from "@comunica/query-sparql";
import { LDPCommunication, LDESinLDP, LDES, storeToString } from "@treecg/versionawareldesinldp";
const N3 = require('n3');
import fs from 'fs';

export class FileStreamer {

    private ldes_stream: string;
    private from_date: Date;
    private to_date: Date;
    public stream_name: RDFStream | undefined;
    public comunica_engine: QueryEngine;
    public ldes!: LDESinLDP;
    public communication: LDPCommunication;
    private observation_array: any[];

    constructor(ldes_stream: string, from_date: Date, to_date: Date, rspEngine: RSPEngine) {
        this.ldes_stream = ldes_stream;
        this.from_date = from_date;
        this.to_date = to_date;
        this.stream_name = rspEngine.getStream(ldes_stream) as RDFStream;
        this.communication = new LDPCommunication();
        this.comunica_engine = new QueryEngine();
        this.observation_array = [];
        this.initialize_file_streamer().then(() => {
            console.log(`Reading from the solid pod is initialized.`);
        });
    }

    public async initialize_file_streamer(): Promise<void> {
        this.ldes = new LDESinLDP(this.ldes_stream, this.communication);
        let streamer_start = Date.now();
        const stream = await this.ldes.readMembersSorted({
            from: this.from_date,
            until: this.to_date,
            chronological: true
        });

        stream.on('data', async (data) => {
            let store = new N3.Store(data.quads)
            let store_string = storeToString(store);
            const timestamp_regex = /"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{4}Z)"/;
            const match = store_string.match(timestamp_regex);
            if (match && match[1]) {
                let timestamp = Date.parse(match[1]);
                await add_event_to_rsp_engine(store, [this.stream_name as RDFStream], timestamp);
            }
        });

        stream.on('end', async () => {
            let streamer_end = Date.now();
            fs.appendFileSync('streamer.txt', `${(streamer_end - streamer_start) / 1000}s\n`);
            console.log(`Decentralized File Streamer has ended.`);
        });
    }
}

export async function add_event_to_rsp_engine(store: any, stream_name: RDFStream[], timestamp: number) {
    stream_name.forEach(async(stream: RDFStream) => {
        let quads = store.getQuads(null, null, null, null);
        for (let quad of quads) {
            stream.add(quad, timestamp);
        }
    });
}

export function epoch(date: string) {
    return Date.parse(date);
}

export function insertion_sort(arr: string[]): string[] {
    const len = arr.length;

    for (let i = 1; i < len; i++) {
        const current = arr[i];
        let j = i - 1;

        while (j >= 0 && arr[j] > current) {
            arr[j + 1] = arr[j];
            j--;
        }

        arr[j + 1] = current;
    }

    return arr;
}