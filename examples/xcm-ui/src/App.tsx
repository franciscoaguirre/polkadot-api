import type { Component } from "solid-js"
import { For, createEffect, createSignal } from "solid-js"

import logo from "./logo.svg"
import styles from "./App.module.css"

import {
  DecodedCall,
  Decoder,
  Shape,
  StringRecord,
  getViewBuilder,
} from "@polkadot-api/metadata-builders"
import { ScProvider, WellKnownChain } from "@polkadot-api/sc-provider"
import { createClient } from "@polkadot-api/substrate-client"
import {
  compact,
  metadata,
  CodecType,
  Tuple,
  V14,
  Struct,
  u8,
} from "@polkadot-api/substrate-bindings"

const smProvider = ScProvider(WellKnownChain.westend2)
const { chainHead } = createClient(smProvider)
type Metadata = CodecType<typeof metadata>
const opaqueMeta = Tuple(compact, metadata)

const getMetadata = (): Promise<Metadata> =>
  new Promise<Metadata>((res, rej) => {
    let requested = false
    const chainHeadFollower = chainHead(
      true,
      (message) => {
        if (message.type === "newBlock") {
          chainHeadFollower.unpin([message.blockHash])
          return
        }
        if (requested || message.type !== "initialized") return
        const latestFinalized = message.finalizedBlockHash
        if (requested) return
        requested = true

        chainHeadFollower
          .call(latestFinalized, "Metadata_metadata", "")
          .then((response) => {
            const [, metadata] = opaqueMeta.dec(response)
            res(metadata)
          })
          .catch((e) => {
            console.log("error", e)
            rej(e)
          })
          .finally(() => {
            chainHeadFollower.unfollow()
          })
      },
      () => {},
    )
  })

const App: Component = () => {
  const [instructions, setInstructions] = createSignal([])
  const [chosenInstructions, setChosenInstructions] = createSignal([])

  createEffect(async () => {
    const chainMetadata = await getMetadata()
    const v14Metadata = chainMetadata.metadata.value as V14
    const xcmPallet = v14Metadata.pallets.find(
      (pallet) => pallet.name === "XcmPallet",
    )
    const { buildDefinition, callDecoder } = getViewBuilder(v14Metadata)
    const definition = buildDefinition(xcmPallet.calls)
    console.log(definition)
    setInstructions(
      Object.entries(
        definition.shape.shape.execute.shape.message.shape.V3.shape.shape,
      ),
    )
    // console.log(Object.entries(definition.shape.shape.execute.shape.message.shape.V3.shape.shape));
    // console.log(definition.shape.shape.execute.shape.message.shape.V3.shape.shape.WithdrawAsset.shape.shape.id.shape.Concrete.shape.interior.shape);
  })

  // TODO: Type
  const handleChooseInstruction = (instruction: any) => {
    const chosen = chosenInstructions()
    setChosenInstructions([...chosen, instruction])
  }

  const handleCopyEncodedCall = () => {}

  return (
    <div class={styles.App}>
      <aside class={styles.aside}>
        <img src={logo} class={styles.logo} alt="logo" />
        <ul class={styles.instructionsContainer}>
          <For each={instructions()}>
            {(instruction) => (
              <li>
                <button onClick={() => handleChooseInstruction(instruction)}>
                  {instruction[0]}
                </button>
              </li>
            )}
          </For>
        </ul>
      </aside>
      <main class={styles.main}>
        <ul>
          <For each={chosenInstructions()}>
            {(instruction) => <InstructionCard instruction={instruction} />}
          </For>
        </ul>
        {chosenInstructions().length > 0 && (
          <button onClick={handleCopyEncodedCall}>Copy encoded call</button>
        )}
      </main>
    </div>
  )
}

const InstructionCard: Component<{
  instruction: [string, { shape: Shape; decoder: Decoder<DecodedCall> }]
}> = (props) => {
  return (
    <li class={styles.card}>
      <h3>{props.instruction[0]}</h3>
      {props.instruction[1].shape !== undefined && (
        <p>
          <DecoderCard shape={props.instruction[1].shape} />
        </p>
      )}
    </li>
  )
}

const DecoderCard: Component<{ shape: Shape }> = (props) => {
  if (props.shape.codec === "Struct") {
    return <StructCard shape={props.shape.shape} />
  } else if (props.shape.codec === "Enum") {
    return <EnumCard shape={props.shape.shape} />
  } else if (props.shape.codec === "u8") {
    return <input type="number" />
  } else if (props.shape.codec === "compactNumber") {
    return <input type="number" />
  } else if (props.shape.codec === "compactBn") {
    return <input type="number" />
  } else if (props.shape.codec === "_void") {
    return <></>
  } else {
    return <p>Codec not handled: {props.shape.codec}</p>
  }
}

const StructCard: Component<{ shape: StringRecord<Shape> }> = (props) => {
  console.log(props.shape)

  return (
    <div class={styles.card}>
      <For each={Object.entries(props.shape)}>
        {([key, value]) => (
          <p>
            {key}: <DecoderCard shape={value} />
          </p>
        )}
      </For>
    </div>
  )
}

const EnumCard: Component<{ shape: StringRecord<Shape> }> = (props) => {
  const [additionalComponent, setAdditionalComponent] = createSignal(<p></p>)

  const handleChange = (key: string) => {
    console.log("Inside handle change")
    console.log(props.shape[key].codec)
    setAdditionalComponent(<DecoderCard shape={props.shape[key]} />)
  }

  return (
    <>
      <select onChange={(event) => handleChange(event.target.value)}>
        <For each={Object.entries(props.shape)}>
          {([key, value]) => <option value={key}>{key}</option>}
        </For>
      </select>
      {additionalComponent()}
    </>
  )
}

export default App
