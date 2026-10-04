/** How much of a long list is on screen: the first `size` items, then `size` more per tap of Show more. */
export class Paged {
  visible = $state(0);

  constructor(readonly size: number) {
    this.visible = size;
  }

  slice<T>(list: readonly T[]): T[] {
    return list.slice(0, this.visible);
  }

  more(): void {
    this.visible += this.size;
  }
}
