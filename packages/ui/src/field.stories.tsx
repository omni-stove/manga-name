import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn } from 'storybook/test'
import { Button } from './button'
import { Checkbox, Field, FieldGroup, Input, Select, TextArea } from './field'

const meta = {
  component: Field,
  args: { label: 'タイトル', children: <Input /> },
} satisfies Meta<typeof Field>

export default meta
type Story = StoryObj<typeof meta>

export const WithInput: Story = { args: { hint: '表紙に出ます' } }

export const WithError: Story = {
  args: { hint: '表紙に出ます', error: '入力してください' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('入力してください')).toBeVisible()
    await expect(canvas.queryByText('表紙に出ます')).toBeNull()
  },
}

export const WithTextArea: Story = { args: { label: 'メモ', children: <TextArea rows={3} /> } }

export const WithSelect: Story = {
  args: {
    label: '判型',
    children: (
      <Select defaultValue="b5">
        <option value="a4">A4</option>
        <option value="b5">B5</option>
      </Select>
    ),
  },
}

export const Group: StoryObj<typeof FieldGroup> = {
  render: (args) => <FieldGroup {...args} />,
  args: {
    label: '書き出し',
    hint: 'どちらも全ページ',
    children: (
      <>
        <Button>PNG</Button>
        <Button>PDF</Button>
      </>
    ),
  },
  play: async ({ canvas }) => {
    const group = canvas.getByRole('group', { name: '書き出し' })
    await expect(group).toContainElement(canvas.getByRole('button', { name: 'PDF' }))
  },
}

export const CheckboxField: StoryObj<typeof Checkbox> = {
  render: (args) => <Checkbox {...args} />,
  args: { label: 'ヒントを使う', children: undefined, onChange: fn() },
}

// 操作すると入力やチェックが残るので、見た目のストーリーとは分ける

export const InputAcceptsTyping: Story = {
  ...WithInput,
  play: async ({ canvas, userEvent }) => {
    // hint も label の内側にあるので、名前は「タイトル表紙に出ます」になる
    const input = canvas.getByRole('textbox', { name: /^タイトル/ })
    await userEvent.type(input, '第一話')
    await expect(input).toHaveValue('第一話')
  },
}

export const TextAreaAcceptsNewlines: Story = {
  ...WithTextArea,
  play: async ({ canvas, userEvent }) => {
    const textarea = canvas.getByRole('textbox', { name: 'メモ' })
    await userEvent.type(textarea, '一行目{Enter}二行目')
    await expect(textarea).toHaveValue('一行目\n二行目')
  },
}

export const SelectChangesValue: Story = {
  ...WithSelect,
  play: async ({ canvas, userEvent }) => {
    const select = canvas.getByRole('combobox', { name: '判型' })
    await userEvent.selectOptions(select, 'a4')
    await expect(select).toHaveValue('a4')
  },
}

export const CheckboxToggles: typeof CheckboxField = {
  ...CheckboxField,
  play: async ({ args, canvas, userEvent }) => {
    const checkbox = canvas.getByRole('checkbox', { name: 'ヒントを使う' })
    await userEvent.click(checkbox)
    await expect(checkbox).toBeChecked()
    await expect(args.onChange).toHaveBeenCalledOnce()
  },
}
