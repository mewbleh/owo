import { describe, expect, it } from 'vitest'

import { parseDiscordCommand } from '../src/discord/commandParser'

describe('parseDiscordCommand', () => {
  it('returns null for normal messages', () => {
    expect(parseDiscordCommand('hello world', '!owo')).toBeNull()
  })

  it('parses command names and args', () => {
    expect(parseDiscordCommand('!owo start now', '!owo')).toEqual({
      name: 'start',
      args: ['now'],
      content: '!owo start now',
    })
  })

  it('requires a prefix boundary', () => {
    expect(parseDiscordCommand('!owostart', '!owo')).toBeNull()
  })

  it('uses help when only the prefix is sent', () => {
    expect(parseDiscordCommand('!owo', '!owo')).toEqual({
      name: 'help',
      args: [],
      content: '!owo',
    })
  })
})
