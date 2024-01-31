import WebSocket from "ws";
import { send_number_of_queries_to_the_aggregator } from "../Util";
const websocket = new WebSocket('ws://n061-20b.wall2.ilabt.iminds.be:8080/', 'solid-stream-aggregator-protocol', {
    perMessageDeflate: false
});

async function send_one_query() {
    await send_number_of_queries_to_the_aggregator(1, websocket);
}

send_one_query();