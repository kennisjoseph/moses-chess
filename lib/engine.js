export class StockfishEngine {
  constructor(path = '/engine/stockfish-19-lite-single.js') {
    this.worker = new Worker(path);
    this.ready = this._sendAndWait('uci', 'uciok').then(() =>
      this._sendAndWait('isready', 'readyok')
    );
  }

  _sendAndWait(command, waitFor) {
    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.includes(waitFor)) {
          this.worker.removeEventListener('message', handler);
          resolve();
        }
      };
      this.worker.addEventListener('message', handler);
      this.worker.postMessage(command);
    });
  }

  async evaluatePosition(fen, depth = 10) {
    await this.ready;
    return new Promise((resolve) => {
      let scoreCp = null;
      let scoreMate = null;

      const handler = (e) => {
        const line = e.data;

        if (line.startsWith('info') && line.includes('score')) {
          const cpMatch = line.match(/score cp (-?\d+)/);
          const mateMatch = line.match(/score mate (-?\d+)/);
          if (cpMatch) {
            scoreCp = parseInt(cpMatch[1], 10);
            scoreMate = null;
          } else if (mateMatch) {
            scoreMate = parseInt(mateMatch[1], 10);
            scoreCp = null;
          }
        }

        if (line.startsWith('bestmove')) {
          this.worker.removeEventListener('message', handler);
          resolve({ scoreCp, scoreMate });
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    });
  }

  terminate() {
    this.worker.terminate();
  }
}