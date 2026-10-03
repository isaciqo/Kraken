'use strict';

// The real `pg` Pool is replaced by a fake, so no connection is ever opened.
const mockConnection = {
  query: jest.fn(),
  release: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
};
const mockPool = {
  connect: jest.fn(),
  on: jest.fn(),
  end: jest.fn(),
};
jest.mock('pg', () => ({ Pool: jest.fn(() => mockPool) }));

const { runInTransaction, isDataException, onConnectionLost, closePool } = require('../../../src/db/client');

// The pool 'error' listener is registered once, when the module is loaded.
const poolErrorListener = mockPool.on.mock.calls.find(([eventName]) => eventName === 'error')[1];

function databaseError(sqlState, message = 'database error') {
  return Object.assign(new Error(message), { code: sqlState });
}

function executedStatements() {
  return mockConnection.query.mock.calls.map(([statement]) => statement);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPool.connect.mockResolvedValue(mockConnection);
  mockConnection.query.mockResolvedValue({ rows: [], rowCount: 0 });
  onConnectionLost(() => {});
});

describe('isDataException', () => {
  describe('class 22: the data of one statement was refused, the job goes on', () => {
    test.each([
      ['22003', 'numeric value out of range'],
      ['22021', 'invalid byte sequence for the encoding'],
      ['22001', 'string too long for the column'],
      ['22P02', 'invalid text representation'],
      ['22000', 'generic data exception'],
    ])('is true for SQLSTATE %s (%s)', (sqlState) => {
      expect(isDataException(databaseError(sqlState))).toBe(true);
    });
  });

  describe('any other error stops the job', () => {
    test.each([
      ['23505', 'unique violation'],
      ['23514', 'check constraint violation'],
      ['54000', 'program limit exceeded (index row too large)'],
      ['57P01', 'connection terminated by the administrator'],
      ['08006', 'connection failure'],
      ['53300', 'too many connections'],
      ['40P01', 'deadlock detected'],
      ['42P01', 'table does not exist'],
      ['ECONNRESET', 'network error code from Node'],
      ['ECONNREFUSED', 'network error code from Node'],
    ])('is false for the code %s (%s)', (errorCode) => {
      expect(isDataException(databaseError(errorCode))).toBe(false);
    });

    test.each([
      ['an error without code', new Error('no code')],
      ['a numeric code', { code: 22003 }],
      ['a code that only starts like a SQLSTATE', { code: '22' }],
      ['a longer code that starts with 22', { code: '220030' }],
      ['null', null],
      ['undefined', undefined],
      ['a string', '22003'],
    ])('is false for %s', (caseName, error) => {
      expect(isDataException(error)).toBe(false);
    });
  });
});

describe('runInTransaction', () => {
  test('commits and returns the result of the block', async () => {
    const result = await runInTransaction(async (connection) => {
      await connection.query('SELECT 1');
      return 'block result';
    });

    expect(result).toBe('block result');
    expect(executedStatements()).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT 1', 'COMMIT']);
    expect(mockConnection.release).toHaveBeenCalledTimes(1);
  });

  test('gives the block the connection of the transaction', async () => {
    const block = jest.fn();

    await runInTransaction(block);

    expect(block).toHaveBeenCalledWith(mockConnection);
  });

  test('uses the requested isolation level', async () => {
    await runInTransaction(async () => {}, { isolationLevel: 'REPEATABLE READ' });

    expect(executedStatements()[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ');
  });

  test('rejects an isolation level it does not know, before opening a connection', async () => {
    await expect(runInTransaction(async () => {}, { isolationLevel: 'READ UNCOMMITTED; DROP TABLE deposits' })).rejects.toThrow(
      'Unsupported isolation level',
    );
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  test('rolls back, releases the connection and rethrows when the block throws', async () => {
    const blockError = databaseError('22003');

    await expect(
      runInTransaction(async () => {
        throw blockError;
      }),
    ).rejects.toBe(blockError);

    expect(executedStatements()).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED', 'ROLLBACK']);
    expect(mockConnection.release).toHaveBeenCalledTimes(1);
  });

  test('rethrows the original error when the rollback itself fails', async () => {
    const blockError = new Error('read ECONNRESET');
    mockConnection.query.mockImplementation(async (statement) => {
      if (statement === 'ROLLBACK') {
        throw new Error('connection is not queryable');
      }
      return { rows: [] };
    });

    await expect(
      runInTransaction(async () => {
        throw blockError;
      }),
    ).rejects.toBe(blockError);
    expect(mockConnection.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back when the commit fails', async () => {
    const commitError = databaseError('40001');
    mockConnection.query.mockImplementation(async (statement) => {
      if (statement === 'COMMIT') {
        throw commitError;
      }
      return { rows: [] };
    });

    await expect(runInTransaction(async () => {})).rejects.toBe(commitError);
    expect(executedStatements()).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED', 'COMMIT', 'ROLLBACK']);
  });

  test('listens to the errors of the connection only while it is in use', async () => {
    await runInTransaction(async () => {});

    expect(mockConnection.on).toHaveBeenCalledWith('error', expect.any(Function));
    const connectionErrorListener = mockConnection.on.mock.calls[0][1];
    expect(mockConnection.removeListener).toHaveBeenCalledWith('error', connectionErrorListener);
  });
});

describe('onConnectionLost', () => {
  test('calls the handler when an idle connection of the pool fails', () => {
    const handler = jest.fn();
    const connectionError = new Error('read ECONNRESET');
    onConnectionLost(handler);

    poolErrorListener(connectionError);

    expect(handler).toHaveBeenCalledWith(connectionError);
  });

  test('calls the handler when the connection in use fails outside of a query', async () => {
    const handler = jest.fn();
    const connectionError = new Error('read ECONNRESET');
    onConnectionLost(handler);

    await runInTransaction(async () => {
      const connectionErrorListener = mockConnection.on.mock.calls[0][1];
      connectionErrorListener(connectionError);
    });

    expect(handler).toHaveBeenCalledWith(connectionError);
  });

  test('does not throw when no handler was registered', () => {
    jest.isolateModules(() => {
      mockPool.on.mockClear();
      require('../../../src/db/client');
    });
    const listenerOfFreshModule = mockPool.on.mock.calls.find(([eventName]) => eventName === 'error')[1];

    expect(() => listenerOfFreshModule(new Error('read ECONNRESET'))).not.toThrow();
  });
});

describe('closePool', () => {
  test('ends the pool', async () => {
    await closePool();

    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });
});
