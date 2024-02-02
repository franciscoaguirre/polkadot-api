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
import { getScProvider, WellKnownChain } from "@polkadot-api/sc-provider"
import { createClient } from "@polkadot-api/substrate-client"
import { getObservableClient } from "@polkadot-api/client"
import { filter, firstValueFrom } from "rxjs"

const ScProvider = getScProvider()
const smProvider = ScProvider(WellKnownChain.westend2).relayChain

const client = getObservableClient(createClient(smProvider))

const getMetadata = async () => {
  const chainHead = client.chainHead$()
  const metadata = await firstValueFrom(
    chainHead.metadata$.pipe(filter(Boolean)),
  )
  chainHead.unfollow()
  return metadata
}

const App: Component = () => {
  const [instructions, setInstructions] = createSignal<any[]>([])
  const [chosenInstructions, setChosenInstructions] = createSignal<any[]>([])

  createEffect(async () => {
    const v14Metadata = await getMetadata()
    const builder = getViewBuilder(v14Metadata)
    const executeView = builder.buildCall("XcmPallet", "execute")

    const xcmExecutionShape = executeView.view.shape
    console.log({ xcmExecutionShape })
    if (xcmExecutionShape.codec !== "Struct") throw null
    const xcmMessage = xcmExecutionShape.shape.message
    if (xcmMessage.codec !== "Enum") throw null
    const xcmMessageV3 = xcmMessage.shape.V3

    setInstructions(Object.entries((xcmMessageV3 as any).shape.shape))
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
