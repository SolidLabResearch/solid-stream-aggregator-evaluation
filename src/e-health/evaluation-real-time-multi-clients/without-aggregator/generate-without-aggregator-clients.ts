import { RSPEngine, RSPQLParser, RDFStream } from "rsp-js";
import * as http from "http";
import * as SETUP from "../../../config/setup.json";
import axios from "axios";
import * as fs from 'fs';
const N3 = require('n3');
const parser = new N3.Parser();

export async function initializeWithoutAggregatorClients(number_of_clients: number, number_of_subscribed_streams: number) {
    const clients: Promise<any>[] = [];
    for (let i = 0; i < number_of_clients; i++) {
        clients.push(without_aggregator_client(number_of_subscribed_streams));
    }
    await Promise.all(clients);
}

const ldes_location = "http://n078-03.wall1.ilabt.imec.be:3000/pod1/acc-x/";
const ldes_location2 = "http://n078-03.wall1.ilabt.imec.be:3000/pod1/acc-y/";
const ldes_location3 = "http://n078-03.wall1.ilabt.imec.be:3000/pod1/acc-z/";

const query = `
PREFIX saref: <https://saref.etsi.org/core/>
PREFIX dahccsensors: <https://dahcc.idlab.ugent.be/Homelab/SensorsAndActuators/>
PREFIX : <https://rsp.js/>
REGISTER RStream <output> AS
SELECT (MAX(?o) as ?max)
FROM NAMED WINDOW :w1 ON STREAM <${ldes_location}> [RANGE 300000 STEP 60000]
WHERE {
    WINDOW :w1 {
        ?s saref:hasValue ?o .
        ?s saref:relatesToProperty dahccsensors:wearable.acceleration.x .
    }   
}
`;

const query2 = `
PREFIX saref: <https://saref.etsi.org/core/>
PREFIX dahccsensors: <https://dahcc.idlab.ugent.be/Homelab/SensorsAndActuators/>
PREFIX : <https://rsp.js/>
REGISTER RStream <output> AS
SELECT (MAX(?o) as ?max) (MAX(?o2) as ?max2)
FROM NAMED WINDOW :w1 ON STREAM <${ldes_location}> [RANGE 300000 STEP 60000]
FROM NAMED WINDOW :w2 ON STREAM <${ldes_location2}> [RANGE 300000 STEP 60000]
WHERE {
    WINDOW :w1 {
        ?s saref:hasValue ?o .
        ?s saref:relatesToProperty dahccsensors:wearable.acceleration.x .
    }
    WINDOW :w2 {
        ?s saref:hasValue ?o2 .
        ?s saref:relatesToProperty dahccsensors:wearable.acceleration.y .
    }
}
`;

const query3 = `
PREFIX saref: <https://saref.etsi.org/core/>
PREFIX dahccsensors: <https://dahcc.idlab.ugent.be/Homelab/SensorsAndActuators/>
PREFIX : <https://rsp.js/>
REGISTER RStream <output> AS
SELECT (MAX(?o) as ?max) (MAX(?o2) as ?max2) (MAX(?o3) as ?max3)
FROM NAMED WINDOW :w1 ON STREAM <${ldes_location}> [RANGE 300000 STEP 60000]
FROM NAMED WINDOW :w2 ON STREAM <${ldes_location2}> [RANGE 300000 STEP 60000]   
FROM NAMED WINDOW :w3 ON STREAM <${ldes_location3}> [RANGE 300000 STEP 60000]
WHERE {
    WINDOW :w1 {
        ?s saref:hasValue ?o .
        ?s saref:relatesToProperty dahccsensors:wearable.acceleration.x .
    }
    WINDOW :w2 {
        ?s saref:hasValue ?o2 .
        ?s saref:relatesToProperty dahccsensors:wearable.acceleration.y .
    }
    WINDOW :w3 {
        ?s saref:hasValue ?o3 .
        ?s saref:relatesToProperty dahccsensors:wearable.acceleration.z .
    }
}
`;

async function without_aggregator_client(number_of_subscribed_streams: number) {
    let rsp_engine: RSPEngine;
    const rsp_parser = new RSPQLParser();
    let parsed_query;
    switch (number_of_subscribed_streams) {
        case 1:
            rsp_engine = new RSPEngine(query);
            parsed_query = rsp_parser.parse(query);
            break;
        case 2:
            rsp_engine = new RSPEngine(query2);
            parsed_query = rsp_parser.parse(query2);
            break;
        case 3:
            rsp_engine = new RSPEngine(query3);
            parsed_query = rsp_parser.parse(query3);
            break;
        default:
            rsp_engine = new RSPEngine(query);
            parsed_query = rsp_parser.parse(query);
            break;
    }

    const stream_array: string[] = [];
    const rsp_emitter = rsp_engine.register();
    const start_find_ldes_stream = Date.now();

    for (const stream of parsed_query.s2r) {
        stream_array.push(stream.stream_name);
    }

    const http_server = http.createServer((request, response) => {
        if (request.method === "POST") {
            let body = "";
            request.on("data", (chunk) => {
                body += chunk.toString();
            });
            request.on("end", async () => {
                try {
                    const notification = JSON.parse(body);
                    const resource_location = notification.object;
                    const ldes_inbox: string = notification.target;
                    console.log(`Received notification from ${ldes_inbox}`);
                    
                    const ldes_location = ldes_inbox.substring(0, ldes_inbox.lastIndexOf("/") + 1);
                    const time_before_fetching = Date.now();
                    const response_fetch = await axios.get(resource_location);
                    const time_after_fetching = Date.now();
                    fs.appendFileSync(`without-aggregator-log.csv`, `time_to_fetch_notification,${time_after_fetching - time_before_fetching}\n`);
                    const time_before_preprocessing = Date.now();
                    const event_data = response_fetch.data;
                    const store = new N3.Store();
                    await parser.parse(event_data, (error: any, quad: any) => {
                        if (error) {
                            console.error(`Error parsing the event data: ${error}`);
                        }
                        else if (quad) {
                            store.addQuad(quad);
                        }
                    });

                    const timestamp = store.getQuads(null, "https://saref.etsi.org/core/hasTimestamp", null, null)[0].object.value;
                    const timestamp_epoch = Date.parse(timestamp);

                    const stream = rsp_engine.getStream(ldes_location) as RDFStream;
                    const time_after_preprocessing = Date.now();
                    fs.appendFileSync(`without-aggregator-log.csv`, `time_to_preprocess_event,${time_after_preprocessing - time_before_preprocessing}\n`);
                    add_event_to_rsp_engine(store, [stream], timestamp_epoch);
                    const time_after_adding_event = Date.now();
                    fs.appendFileSync(`without-aggregator-log.csv`, `time_to_add_event_to_rsp_engine,${time_after_adding_event - time_after_preprocessing}\n`);
                    response.writeHead(200, { "Content-Type": "text/plain" });
                    response.end("200 - OK");
                }
                catch (error) {
                    response.writeHead(400, "Bad Request", { "Content-Type": "text/plain" });
                    response.end("400 - Bad Request");
                }
            });
        }
        else {
            response.writeHead(405, "Method Not Allowed", { "Content-Type": "text/plain" });
            response.end("405 - Method Not Allowed");
        }
    });

    const http_port: any = await setupServer(http_server);

    for (const stream of stream_array) {
        let stream_location = rsp_engine.getStream(stream) as RDFStream;
        const time_before_subscribing = Date.now();
        const if_subscription_is_true = await subscribe_notifications(stream_location, http_port);
        if (if_subscription_is_true){
            const time_after_subscribing = Date.now();
            fs.appendFileSync(`without-aggregator-log.csv`, `time_to_subscribe_notifications,${time_after_subscribing - time_before_subscribing}\n`);
        }
        console.log(`Subscribed to notifications for the stream ${stream_location.name} on port ${http_port}`);
    }
    const time_to_start_subscribing_results = Date.now();
    subscribe_to_results(rsp_emitter, time_to_start_subscribing_results);

}

export function add_event_to_rsp_engine(store: any, stream_name: RDFStream[], timestamp: number) {
    stream_name.forEach(async (stream: RDFStream) => {
        let quads = store.getQuads(null, null, null, null);
        for (let quad of quads) {
            stream.add(quad, timestamp);
        }
    });
}

async function setupServer(http_server: any): Promise<number> {
    return new Promise((resolve, reject) => {
        http_server.listen(0, () => {
            const http_port = http_server.address().port;
            resolve(http_port);
        });
        http_server.on('error', reject);
    });
}


async function subscribe_notifications(stream_location: RDFStream, http_port: number) {
    const inbox = await extract_inbox(stream_location.name) as string;
    const subscription_server = await extract_subscription_server(inbox);
    if (subscription_server) {
        const body = {
            "@context": ["https://www.w3.org/ns/solid/notification/v1"],
            "type": "http://www.w3.org/ns/solid/notifications#WebhookChannel2023",
            "topic": inbox,
            "sendTo": `${SETUP.without_aggregagtor_location}:${http_port}/`,
        }

        const response = await axios.post(subscription_server.location, body, {
            headers: {
                'Content-Type': 'application/ld+json'
            }
        });

        if (response.status === 200) {
            return true;
        }
        else {
            console.error(`The subscription to the notification server failed with status code ${response.status}`)
        }
    }
    else {
        console.error("No subscription server found. It is not defined in the metadata of the Solid Server.");
    }
}

async function extract_inbox(stream_location: string) {
    const store = new N3.Store();
    try {
        const response = await axios.get(stream_location);
        if (response) {
            await parser.parse(response.data, (error: any, quad: any) => {
                if (error) {
                    console.error(`Error parsing the LDES Stream's Metadata`, error)
                }
                if (quad) {
                    store.addQuad(quad);
                }
            });
            const inbox = store.getQuads(null, "http://www.w3.org/ns/ldp#inbox", null)[0].object.value;
            return stream_location + inbox;
        } else {
            console.error("No response received from the server");
        }
    } catch (error) {
        console.error(error);
    }
}

async function extract_subscription_server(resource: string) {
    const store = new N3.Store();
    try {
        const response = await axios.head(resource);
        const link_header = response.headers['link'];
        if (link_header) {
            const link_header_parts = link_header.split(',');
            for (const part of link_header_parts) {
                const [link, rel] = part.split(';').map((item: string) => item.trim());
                if (rel === 'rel="http://www.w3.org/ns/solid/terms#storageDescription"') {
                    const storage_description_link = link.slice(1, -1);
                    const storage_description_response = await axios.get(storage_description_link);
                    const storage_description = storage_description_response.data;
                    await parser.parse(storage_description, (error: any, quad: any) => {
                        if (quad) {
                            store.addQuad(quad);
                        }
                    });
                    const subscription_server = store.getQuads(null, "http://www.w3.org/ns/solid/notifications#subscription", null)[0].object.value;
                    const subscription_type = store.getQuads(null, "http://www.w3.org/ns/solid/notifications#channelType", null)[0].object.value;
                    const channel_location = store.getQuads(null, "http://www.w3.org/ns/solid/notifications#channelType", null)[0].subject.value;

                    const subscription_response = {
                        location: subscription_server,
                        channelType: subscription_type,
                        channelLocation: channel_location
                    }
                    return subscription_response;
                }
                else {
                    continue;
                }
            }
        }
    } catch (error) {
        console.error(`Error extracting subscription server from ${resource}`, error)
    }
}


export function subscribe_to_results(rsp_emitter: any, time_to_start_subscribing_results: number) {
    const listener = (event: any) => {
        let iterable = event.bindings.values();
        for (let item of iterable) {
            const time_recieved_aggregated_result = Date.now();
            fs.appendFileSync(`without-aggregator-log.csv`, `time_received_aggregation_event,${time_recieved_aggregated_result - time_to_start_subscribing_results}\n`);
            time_to_start_subscribing_results = time_recieved_aggregated_result;
            fs.appendFileSync(`result.csv`, `${item.value}\n`);
        }
    }
    rsp_emitter.on('RStream', listener);
    rsp_emitter.on('end', () => {
        rsp_emitter.removeListener('RStream', listener);
    });
}