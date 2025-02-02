import { WellKnownChain } from "@substrate/connect"
import { createClient } from "@polkadot-api/substrate-client"
import type { ConnectProvider } from "@polkadot-api/json-rpc-provider"
import { fromHex } from "@polkadot-api/utils"
import * as fs from "node:fs/promises"
import {
  metadata as $metadata,
  OpaqueCodec,
} from "@polkadot-api/substrate-bindings"
import { PROVIDER_WORKER_CODE } from "./smolldot-worker"
import { Worker } from "node:worker_threads"
import { WebSocketProvider } from "./websocket-provider"
import { getObservableClient } from "@polkadot-api/client"
import { firstValueFrom, map, switchMap, take } from "rxjs"

type Metadata = ReturnType<typeof $metadata.dec>["metadata"]

const getMetadataCall = async (provider: ConnectProvider) => {
  const client = getObservableClient(createClient(provider))
  const { finalized$, call$, unfollow } = client.chainHead$()
  const metadata = await firstValueFrom(
    finalized$.pipe(
      take(1),
      switchMap((block) => call$(block.hash, "Metadata_metadata", "")),
      map(fromHex),
    ),
  )

  unfollow()
  client.destroy()

  return metadata
}

const getMetadataFromWellKnownChain = async (chain: WellKnownChain) => {
  const provider: ConnectProvider = (onMsg) => {
    let worker: Worker | null = new Worker(PROVIDER_WORKER_CODE, {
      eval: true,
      workerData: chain,
      stderr: true,
      stdout: true,
    })
    worker.on("message", onMsg)

    return {
      send: (msg) => worker?.postMessage({ type: "send", value: msg }),
      disconnect: () => {
        if (!worker) return

        worker.postMessage({ type: "disconnect" })
        worker.removeAllListeners()
        worker.terminate()
        worker = null
      },
    }
  }

  return getMetadataCall(provider)
}

const getMetadataFromWsURL = async (wsURL: string) => {
  const provider: ConnectProvider = WebSocketProvider(wsURL)

  return getMetadataCall(provider)
}

export type GetMetadataArgs =
  | {
      source: "chain"
      chain: WellKnownChain
    }
  | {
      source: "ws"
      url: string
    }
  | {
      source: "file"
      file: string
    }

async function getRawMetadata(args: GetMetadataArgs): Promise<Uint8Array> {
  switch (args.source) {
    case "chain": {
      return getMetadataFromWellKnownChain(args.chain)
    }
    case "ws": {
      return getMetadataFromWsURL(args.url)
    }
    case "file": {
      return fs.readFile(args.file)
    }
  }
}

export async function getMetadata(args: GetMetadataArgs) {
  const rawMetadata = await getRawMetadata(args)
  const { inner } = OpaqueCodec($metadata).dec(rawMetadata)

  const { magicNumber, metadata } = inner()

  assertIsv14(metadata)

  return { magicNumber, metadata }
}

function assertIsv14(
  metadata: Metadata,
): asserts metadata is Metadata & { tag: "v14" } {
  if (metadata.tag !== "v14") {
    throw new Error("unreachable")
  }
}
