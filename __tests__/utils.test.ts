import fs from 'fs'
import { mocked } from 'ts-jest/utils'
import {
  checkFiles,
  readRequiredContext,
  generateIgnore,
  postComment,
} from '../src/utils'
import * as core from '@actions/core'
import * as github from '@actions/github'
import ignore from 'ignore'
import nock from 'nock'

jest.mock('fs')
describe('index', () => {
  describe('generateIgnore', () => {
    let mockedRead: jest.MockedFunction<typeof fs.readFileSync>
    let mockedExist: jest.MockedFunction<typeof fs.existsSync>
    beforeEach(() => {
      mockedRead = mocked(fs.readFileSync) as jest.MockedFunction<
        typeof fs.readFileSync
      >
      mockedExist = mocked(fs.existsSync)
    })

    afterEach(() => {
      mockedRead.mockClear()
      mockedExist.mockClear()
    })

    it('Should generate globber based on contents in CODEOWNER file with one codeonwer pattern and comments', () => {
      mockedRead.mockReturnValue(`
        # This is a comment
        *.js     @someone
    `)
      mockedExist.mockReturnValue(true)
      const ig = ignore()
      const spyAdd = jest.spyOn(ig, 'add')
      generateIgnore(ig, 'CODEOWNER')
      expect(mockedRead.mock.calls.length).toBe(1)
      expect(mockedRead.mock.calls[0][0]).toBe('CODEOWNER')
      expect(spyAdd).toHaveBeenCalledTimes(1)
      expect(spyAdd).toHaveBeenCalledWith('*.js')
      // The existsSync may be invoked multiple times by other dependencies,
      // to avoid potential issues, we are not testing the times it is iovoked.
      expect(mockedExist).toHaveBeenCalledWith('CODEOWNER')
    })

    it('Should generate globber based on contents in default CODEOWNER file with one codeonwer pattern and comments', () => {
      mockedRead.mockReturnValue(`
        # This is a comment
        *.js     @someone
    `)
      mockedExist.mockReturnValue(true)
      const ig = ignore()
      const spyAdd = jest.spyOn(ig, 'add')
      generateIgnore(ig, undefined)
      expect(mockedRead.mock.calls.length).toBe(1)
      expect(mockedRead.mock.calls[0][0]).toBe('.github/CODEOWNERS')
      expect(spyAdd).toHaveBeenCalledTimes(1)
      expect(spyAdd).toHaveBeenCalledWith('*.js')
      expect(mockedExist).toHaveBeenCalledWith('.github/CODEOWNERS')
    })

    it('Should generate globber based on contents in CODEOWNER file with three codeowner patterns and comments', () => {
      mockedRead.mockReturnValue(`
        # This is a comment
        *        @org/default
        *.js     @someone
        # another comment 
        src/*.js
    `)
      mockedExist.mockReturnValue(true)
      const ig = ignore()
      const spyAdd = jest.spyOn(ig, 'add')
      generateIgnore(ig, 'CODEOWNER')
      expect(mockedRead.mock.calls.length).toBe(1)
      expect(mockedRead.mock.calls[0][0]).toBe('CODEOWNER')
      expect(spyAdd).toHaveBeenCalledTimes(3)
      expect(spyAdd).toHaveBeenNthCalledWith(1, '*')
      expect(spyAdd).toHaveBeenNthCalledWith(2, '*.js')
      expect(spyAdd).toHaveBeenNthCalledWith(3, 'src/*.js')
      expect(mockedExist).toHaveBeenCalledWith('CODEOWNER')
    })

    it('Should generate globber based on contents in CODEOWNER file and skip asterisk', () => {
      const spyGetSkipAsteriskInput = jest.spyOn(core, 'getInput')

      spyGetSkipAsteriskInput.mockReturnValue('true')
      mockedRead.mockReturnValue(`
        # This is a comment
        *        @org/default
        *.js     @someone
        # another comment 
        src/*.js
    `)
      mockedExist.mockReturnValue(true)
      const ig = ignore()
      const spyAdd = jest.spyOn(ig, 'add')
      generateIgnore(ig, 'CODEOWNER')
      expect(mockedRead.mock.calls.length).toBe(1)
      expect(mockedRead.mock.calls[0][0]).toBe('CODEOWNER')
      expect(spyAdd).toHaveBeenCalledTimes(2)
      expect(spyAdd).toHaveBeenNthCalledWith(1, '*.js')
      expect(spyAdd).toHaveBeenNthCalledWith(2, 'src/*.js')
      expect(mockedExist).toHaveBeenCalledWith('CODEOWNER')

      spyGetSkipAsteriskInput.mockClear()
    })

    it('Should throw an error when the provided codeowner file does not exist', () => {
      mockedRead.mockReturnValue(`
        # This is a comment
        *.js     @someone
        # another comment 
        src/*.js
    `)
      mockedExist.mockReturnValue(false)
      const ig = ignore()

      expect(() => generateIgnore(ig, 'CODEOWNER')).toThrowError(
        'CODEOWNERS file CODEOWNER not exist.'
      )
    })
  })

  describe('checkFiles', () => {
    it('Should pass when all the files are covered', () => {
      const ig = ignore().add('file1').add('file2')
      return checkFiles(ig, ['file1', 'file2']).then((result) => {
        expect(result).toEqual([])
      })
    })

    it('Should fail when not all the files are covered', () => {
      const ig = ignore().add('file1')
      return checkFiles(ig, ['file1', 'file2']).then((result) => {
        expect(result).toEqual(['file2'])
      })
    })
  })

  describe('readRequiredContext', () => {
    const OLD_ENV = process.env
    const originalContext = { ...github.context }
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })

    afterEach(() => {
      process.env = OLD_ENV
      github.context.payload.number = originalContext.payload.number
      jest.clearAllMocks()
    })

    it('Should not throw any error when the required environment variables are provided', () => {
      process.env = {
        GITHUB_TOKEN: 'token',
      }
      github.context.payload.number = 23
      const [token, prNumber] = readRequiredContext()
      expect(token).toBe('token')
      expect(prNumber).toBe(23)
    })

    it('Should throw error when GITHUB_TOKEN is not provided', () => {
      process.env = {}
      expect(readRequiredContext).toThrow('Failed to read GITHUB_TOKEN')
    })
  })

  describe('postComment', () => {
    let spyGetInput: jest.SpiedFunction<typeof core.getInput>
    beforeEach(() => {
      spyGetInput = jest.spyOn(core, 'getInput')
    })

    afterEach(() => {
      spyGetInput.mockClear()
    })
    it('It should post a comment to the corresponding PR', () => {
      const scope = nock('https://api.github.com')
        .post('/repos/some-owner/some-repo/issues/40/comments', {
          body: 'The following files do not have CODEOWNER\n- file1\n- file2',
        })
        .reply(200)
      const octokit = github.getOctokit('token')
      spyGetInput.mockReturnValue('true')
      return postComment(
        ['file1', 'file2'],
        'some-owner',
        'some-repo',
        40,
        octokit
      ).then(() => {
        scope.done()
        expect(spyGetInput).toHaveBeenCalledTimes(1)
        expect(spyGetInput).toHaveBeenCalledWith('POST_COMMENT')
      })
    })

    it('It should not post a comment to the corresponding PR when input POST_COMMENT is false', () => {
      const octokit = github.getOctokit('token')
      const spyRequest = jest.spyOn(octokit, 'request')
      spyGetInput.mockReturnValue('false')
      return postComment(
        ['file1', 'file2'],
        'some-owner',
        'some-repo',
        40,
        octokit
      ).then(() => {
        expect(spyRequest).toHaveReturnedTimes(0)
        expect(spyGetInput).toHaveBeenCalledTimes(1)
        expect(spyGetInput).toHaveBeenCalledWith('POST_COMMENT')
      })
    })

    it('Should not post any comment to the PR if no file is provided', () => {
      const octokit = github.getOctokit('token')
      const mockedReqeust = spyOn(octokit, 'request')
      return postComment([], '', '', 1, octokit).then(() =>
        expect(mockedReqeust).toHaveBeenCalledTimes(0)
      )
    })
  })
})
