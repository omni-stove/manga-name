import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn } from 'storybook/test'
import { SegmentedControl, type SegmentedOption } from './segmented-control'

type Mode = 'select' | 'panel' | 'balloon'

const options: SegmentedOption<Mode>[] = [
  { value: 'select', label: '選択', shortcut: 'v' },
  { value: 'panel', label: 'コマ', shortcut: 'p' },
  { value: 'balloon', label: 'フキダシ', disabled: true },
]

const meta = {
  component: SegmentedControl<Mode>,
  args: { label: 'ツール', value: 'select', options, onChange: fn() },
  // value を親が持つ部品なので、操作で選択が動くよう状態を持たせる
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return (
      <SegmentedControl
        {...args}
        value={value}
        onChange={(v) => {
          setValue(v)
          args.onChange(v)
        }}
      />
    )
  },
} satisfies Meta<typeof SegmentedControl<Mode>>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

// 操作すると選択が動くので、見た目のストーリーとは分ける
export const ClickAndArrowKeysSelect: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('group', { name: 'ツール' })).toBeVisible()
    await expect(canvas.getByRole('radio', { name: '選択' })).toBeChecked()

    // radio は見た目上隠していて、押すのはラベル
    await userEvent.click(canvas.getByText('コマ'))
    await expect(args.onChange).toHaveBeenLastCalledWith('panel')
    await expect(canvas.getByRole('radio', { name: 'コマ' })).toBeChecked()

    await userEvent.keyboard('{ArrowLeft}')
    await expect(args.onChange).toHaveBeenLastCalledWith('select')
    await expect(canvas.getByRole('radio', { name: 'フキダシ' })).toBeDisabled()
  },
}
