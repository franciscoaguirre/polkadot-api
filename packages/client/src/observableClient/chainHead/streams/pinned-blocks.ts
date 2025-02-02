import { BlockHeader } from "@polkadot-api/substrate-bindings"
import { FollowEventWithRuntime } from "@polkadot-api/substrate-client"
import {
  Observable,
  Subscription,
  concatMap,
  defer,
  filter,
  interval,
  map,
  merge,
  of,
  pairwise,
  scan,
  tap,
  withLatestFrom,
} from "rxjs"
import { getRuntimeCreator, Runtime } from "./get-runtime-creator"
import { selfDependent, shareLatest } from "@/utils"

export interface PinnedBlock {
  hash: string
  number: number
  parent: string
  children: Set<string>
  runtime: string
  refCount: number
}

export interface BlockUsageEvent {
  type: "blockUsage"
  value: { type: "hold"; hash: string } | { type: "release"; hash: string }
}

export type PinnedBlocks = {
  best: string
  finalized: string
  runtimes: Record<string, Runtime>
  blocks: Map<string, PinnedBlock>
  finalizedRuntime: Runtime
}

export const getPinnedBlocks$ = (
  follow$: Observable<FollowEventWithRuntime>,
  getHeader: (hash: string) => Promise<BlockHeader>,
  call$: (hash: string, method: string, args: string) => Observable<string>,
  blockUsage$: Observable<BlockUsageEvent>,
  onUnpin: (blocks: string[]) => void,
) => {
  const getRuntime = getRuntimeCreator(call$)
  const followWithInitializedNumber$ = follow$.pipe(
    concatMap((event) => {
      return event.type !== "initialized"
        ? of(event)
        : getHeader(event.finalizedBlockHash).then((header) => ({
            ...event,
            number: header.number,
            parentHash: header.parentHash,
          }))
    }),
  )

  const [unpinnedBlocks$, connectUnpinnedBlocks] = selfDependent<string[]>()

  const cleaner$ = interval(100).pipe(
    withLatestFrom(defer(() => pinnedBlocks$)),
    map(([, pinned]) => {
      const result = new Set<string>()

      let current = pinned.blocks.get(pinned.finalized)!
      while (pinned.blocks.has(current.parent)) {
        current = pinned.blocks.get(current.parent)!
        if (!current.refCount) result.add(current.hash)
      }

      return result
    }),
    pairwise(),
    map(([prev, current]) => [...current].filter((x) => prev.has(x))),
    filter((x) => x.length > 0),
    connectUnpinnedBlocks(),
    tap(onUnpin),
    <T>(source$: Observable<T>) =>
      new Observable<never>((observer) => {
        let subscription: Subscription | null = null
        // let's delay the initial subscription
        const token = setTimeout(() => {
          subscription = source$.subscribe({
            error(e) {
              observer.error(e)
            },
          })
          subscription.add(
            // and let's make sure that it completes when follow$ is done
            follow$.subscribe({
              complete() {
                observer.complete()
              },
            }),
          )
        }, 0)

        return () => {
          clearTimeout(token)
          subscription?.unsubscribe()
        }
      }),
  )

  const pinnedBlocks$: Observable<PinnedBlocks> = merge(
    blockUsage$,
    followWithInitializedNumber$,
    unpinnedBlocks$.pipe(
      map((hashes) => ({ type: "unpin" as "unpin", hashes })),
    ),
    cleaner$,
  ).pipe(
    scan(
      (acc, event) => {
        switch (event.type) {
          case "initialized":
            const hash = event.finalizedBlockHash
            acc.finalized = acc.best = hash

            acc.blocks.set(hash, {
              hash,
              parent: event.parentHash,
              children: new Set(),
              runtime: hash,
              refCount: 0,
              number: event.number,
            })
            acc.runtimes[hash] = getRuntime(hash)
            acc.finalizedRuntime = acc.runtimes[hash]
            return acc

          case "newBlock": {
            const { parentBlockHash: parent, blockHash: hash } = event
            const parentNode = acc.blocks.get(parent)!
            parentNode.children.add(hash)
            if (event.newRuntime) {
              acc.runtimes[hash] = getRuntime(hash)
              acc.runtimes[hash].runtime.subscribe()
            }
            const block = {
              hash,
              number: parentNode.number + 1,
              parent: parent,
              children: new Set<string>(),
              runtime: event.newRuntime ? hash : parentNode.runtime,
              refCount: 0,
            }
            acc.blocks.set(hash, block)
            acc.runtimes[block.runtime].addBlock(hash)
            return acc
          }

          case "bestBlockChanged": {
            acc.best = event.bestBlockHash
            return acc
          }

          case "finalized": {
            acc.finalized = event.finalizedBlockHashes.slice(-1)[0]
            acc.finalizedRuntime =
              acc.runtimes[acc.blocks.get(acc.finalized)!.runtime]
            return acc
          }

          case "blockUsage": {
            acc.blocks.get(event.value.hash)!.refCount +=
              event.value.type === "hold" ? 1 : -1
            return acc
          }

          case "unpin": {
            event.hashes.forEach((h) => {
              if (!acc.blocks.has(h)) return

              acc.blocks.get(acc.blocks.get(h)!.parent)?.children.delete(h)
              acc.blocks.delete(h)
            })

            Object.entries(acc.runtimes)
              .map(([key, value]) => ({
                key,
                usages: value.deleteBlocks(event.hashes),
              }))
              .filter((x) => x.usages === 0)
              .map((x) => x.key)
              .forEach((unsusedRuntime) => {
                delete acc.runtimes[unsusedRuntime]
              })

            return acc
          }
        }
      },
      {
        best: "",
        finalized: "",
        runtimes: {},
        blocks: new Map(),
        finalizedRuntime: {},
      } as PinnedBlocks,
    ),
    map((x) => ({ ...x })),
    shareLatest,
  )

  return pinnedBlocks$
}
