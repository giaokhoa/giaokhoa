
export type AvailabilityOp = '&' | '|' | '!&' | '!|';

export interface AvailabilityLeaf {
  type: string;
  [key: string]: unknown;
}

export interface AvailabilityNode {
  op: AvailabilityOp;
  c: AvailabilityChild[];
  show?: boolean;
  showc?: boolean[];
}
export type AvailabilityChild = AvailabilityNode | AvailabilityLeaf;

export function isTreeNode(child: AvailabilityChild): child is AvailabilityNode {
  return typeof (child as AvailabilityNode).op === 'string' && Array.isArray((child as AvailabilityNode).c);
}

export interface LeafResult {
  available: boolean;
  description?: string;
}

export interface TreeEvaluation {
  available: boolean;
  informationHidden: boolean;
  failedDescriptions: string[];
  visible: boolean;
  children: (TreeEvaluation | LeafResult & { leaf: true })[];
}

const OPS: AvailabilityOp[] = ['&', '|', '!&', '!|'];

export function parseAvailabilityTree(raw: unknown): AvailabilityNode | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') throw new Error('Availability tree must be an object');
  const node = raw as Record<string, unknown>;
  if (!OPS.includes(node.op as AvailabilityOp)) throw new Error(`Invalid availability op ${String(node.op)}`);
  if (!Array.isArray(node.c)) throw new Error('Availability tree node must have a c array');
  for (const child of node.c as AvailabilityChild[]) {
    if (isTreeNode(child)) parseAvailabilityTree(child);
    else if (typeof (child as AvailabilityLeaf).type !== 'string') throw new Error('Availability leaf must have a type');
  }
  return raw as AvailabilityNode;
}

function aggregate(op: AvailabilityOp, values: boolean[]): boolean {
  switch (op) {
    case '&': return values.every(Boolean);
    case '|': return values.some(Boolean);
    case '!&': return !values.every(Boolean);
    case '!|': return !values.some(Boolean);
  }
}

export async function evaluateTree(
  node: AvailabilityNode,
  evaluateLeaf: (leaf: AvailabilityLeaf) => Promise<LeafResult>,
  isRoot = true,
): Promise<TreeEvaluation> {
  const childResults: TreeEvaluation['children'] = [];
  const values: boolean[] = [];
  for (const child of node.c) {
    if (isTreeNode(child)) {
      const r = await evaluateTree(child, evaluateLeaf, false);
      childResults.push(r);
      values.push(r.available);
    } else {
      const r = await evaluateLeaf(child);
      childResults.push({ ...r, leaf: true });
      values.push(r.available);
    }
  }
  const available = node.c.length === 0 ? (node.op === '&' || node.op === '|') : aggregate(node.op, values);

  let informationHidden = false;
  if (!available) {
    if (isRoot && node.show === false) informationHidden = true;
    node.c.forEach((child, i) => {
      const showc = node.showc?.[i];
      if (showc === false) {
        const childAvailable = values[i]!;
        const negated = node.op === '!&' || node.op === '!|';
        const causesFailure = negated ? childAvailable : !childAvailable;
        if (causesFailure) informationHidden = true;
        const cr = childResults[i] as TreeEvaluation;
        if (!isTreeNode(child) === false && cr && 'informationHidden' in cr && cr.informationHidden && causesFailure) {
          informationHidden = true;
        }
      }
    });
    node.c.forEach((child, i) => {
      if (isTreeNode(child)) {
        const cr = childResults[i] as TreeEvaluation;
        const negated = node.op === '!&' || node.op === '!|';
        const causesFailure = negated ? values[i]! : !values[i]!;
        if (cr.informationHidden && causesFailure && node.showc?.[i] !== true) {
          if (node.showc !== undefined && node.showc[i] === false) informationHidden = true;
        }
      }
    });
  }

  const failedDescriptions: string[] = [];
  if (!available && !informationHidden) {
    node.c.forEach((_child, i) => {
      const negated = node.op === '!&' || node.op === '!|';
      const causesFailure = negated ? values[i]! : !values[i]!;
      if (!causesFailure) return;
      if (node.showc !== undefined && node.showc[i] === false) return;
      const cr = childResults[i]!;
      if ('failedDescriptions' in cr) failedDescriptions.push(...(cr as TreeEvaluation).failedDescriptions);
      else if ((cr as LeafResult).description) {
        const desc = (cr as LeafResult).description!;
        failedDescriptions.push(negated && isRoot ? `!${desc}` : desc);
      }
    });
  }

  return {
    available,
    informationHidden,
    failedDescriptions,
    visible: available || !informationHidden,
    children: childResults,
  };
}

export function leafFromMap(values: Record<string, boolean>, descriptions: Record<string, string> = {}) {
  return async (leaf: AvailabilityLeaf): Promise<LeafResult> => {
    const key = String(leaf.id ?? leaf.type);
    return { available: values[key] ?? false, description: descriptions[key] ?? key };
  };
}
