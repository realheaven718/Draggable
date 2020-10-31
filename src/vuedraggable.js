import Sortable from "sortablejs";
import { insertNodeAt, removeNode } from "./util/htmlHelper";
import { console } from "./util/console";
import {
  getComponentAttributes,
  createSortableOption,
  getValidSortableEntries
} from "./core/componentBuilderHelper";
import { computeComponentStructure } from "./core/renderHelper";
import { h, defineComponent, nextTick } from "vue";

function computeVmIndex(vNodes, htmlElement) {
  const domElements = vNodes.map(({ el }) => el);
  const index = domElements.indexOf(htmlElement);
  if (index === -1) {
    throw new Error("node not found", {
      nodes: domElements,
      htmlElement
    });
  }
  return index;
}

function emit(evtName, evtData) {
  nextTick(() => this.$emit(evtName.toLowerCase(), evtData));
}

function manage(evtName) {
  return (evtData, originalElement) => {
    if (this.realList !== null) {
      return this[`onDrag${evtName}`](evtData, originalElement);
    }
  };
}

function manageAndEmit(evtName) {
  const delegateCallBack = manage.call(this, evtName);
  return (evtData, originalElement) => {
    delegateCallBack.call(this, evtData, originalElement);
    emit.call(this, evtName, evtData);
  };
}

let draggingElement = null;

const props = {
  list: {
    type: Array,
    required: false,
    default: null
  },
  modelValue: {
    type: Array,
    required: false,
    default: null
  },
  clone: {
    type: Function,
    default: original => {
      return original;
    }
  },
  tag: {
    type: String,
    default: "div"
  },
  move: {
    type: Function,
    default: null
  },
  componentData: {
    type: Object,
    required: false,
    default: null
  }
};

const draggableComponent = defineComponent({
  name: "draggable",

  inheritAttrs: false,

  props,

  render() {
    const { $slots, $attrs, tag, componentData, $el } = this;
    const componentStructure = computeComponentStructure({ $slots, tag, $el });
    this.componentStructure = componentStructure;
    const attributes = getComponentAttributes({ $attrs, componentData });
    return h(componentStructure.tag, attributes, componentStructure.children);
  },

  created() {
    if (this.list !== null && this.modelValue !== null) {
      console.error(
        "modelValue and list props are mutually exclusive! Please set one or another."
      );
    }
  },

  mounted() {
    const { $attrs, $el, componentStructure } = this;
    componentStructure.setHtmlRoot($el);

    const sortableOptions = createSortableOption({
      $attrs,
      callBackBuilder: {
        manageAndEmit: event => manageAndEmit.call(this, event),
        emit: event => emit.bind(this, event),
        manage: event => manage.call(this, event)
      }
    });
    const {
      componentStructure: { rootContainer }
    } = this;
    this._sortable = new Sortable(rootContainer, sortableOptions);
    rootContainer.__draggable_component__ = this;
    this.computeIndexes();
  },

  beforeUnmount() {
    if (this._sortable !== undefined) this._sortable.destroy();
  },

  computed: {
    realList() {
      return this.list ? this.list : this.modelValue;
    }
  },

  watch: {
    $attrs: {
      handler(newOptionValue) {
        this.updateOptions(newOptionValue);
      },
      deep: true
    },

    realList() {
      this.computeIndexes();
    }
  },

  methods: {
    updateOptions(newOptionValue) {
      const { _sortable } = this;
      getValidSortableEntries(newOptionValue).forEach(([key, value]) => {
        _sortable.option(key, value);
      });
    },

    computeIndexes() {
      nextTick(() => {
        this.visibleIndexes = this.componentStructure.computeIndexes();
      });
    },

    getUnderlyingVm(htmlElement) {
      const childrenNodes = this.componentStructure.getChildrenNodes();
      const index = computeVmIndex(childrenNodes, htmlElement);
      if (index === -1) {
        //Edge case during move callback: related element might be
        //an element different from collection
        return null;
      }
      const element = this.realList[index];
      return { index, element };
    },

    getUnderlyingPotencialDraggableComponent(htmElement) {
      //TODO check case where you need to see component children
      return htmElement.__draggable_component__;
    },

    emitChanges(evt) {
      nextTick(() => {
        this.$emit("change", evt);
      });
    },

    alterList(onList) {
      if (this.list) {
        onList(this.list);
        return;
      }
      const newList = [...this.modelValue];
      onList(newList);
      this.$emit("update:modelValue", newList);
    },

    spliceList() {
      const spliceList = list => list.splice(...arguments);
      this.alterList(spliceList);
    },

    updatePosition(oldIndex, newIndex) {
      const updatePosition = list =>
        list.splice(newIndex, 0, list.splice(oldIndex, 1)[0]);
      this.alterList(updatePosition);
    },

    getRelatedContextFromMoveEvent({ to, related }) {
      const component = this.getUnderlyingPotencialDraggableComponent(to);
      if (!component) {
        return { component };
      }
      const list = component.realList;
      const context = { list, component };
      if (to !== related && list) {
        const destination = component.getUnderlyingVm(related) || {};
        return { ...destination, ...context };
      }
      return context;
    },

    getVmIndexFromDomIndex(domIndex) {
      const indexes = this.visibleIndexes;
      const numberIndexes = indexes.length;
      return domIndex > numberIndexes - 1 ? numberIndexes : indexes[domIndex];
    },

    onDragStart(evt) {
      this.context = this.getUnderlyingVm(evt.item);
      evt.item._underlying_vm_ = this.clone(this.context.element);
      draggingElement = evt.item;
    },

    onDragAdd(evt) {
      const element = evt.item._underlying_vm_;
      if (element === undefined) {
        return;
      }
      removeNode(evt.item);
      const newIndex = this.getVmIndexFromDomIndex(evt.newIndex);
      this.spliceList(newIndex, 0, element);
      this.computeIndexes();
      const added = { element, newIndex };
      this.emitChanges({ added });
    },

    onDragRemove(evt) {
      const {
        componentStructure: { rootContainer }
      } = this;
      insertNodeAt(rootContainer, evt.item, evt.oldIndex);
      if (evt.pullMode === "clone") {
        removeNode(evt.clone);
        return;
      }
      const { index: oldIndex, element } = this.context;
      this.spliceList(oldIndex, 1);
      const removed = { element, oldIndex };
      this.emitChanges({ removed });
    },

    onDragUpdate(evt) {
      removeNode(evt.item);
      insertNodeAt(evt.from, evt.item, evt.oldIndex);
      const oldIndex = this.context.index;
      const newIndex = this.getVmIndexFromDomIndex(evt.newIndex);
      this.updatePosition(oldIndex, newIndex);
      const moved = { element: this.context.element, oldIndex, newIndex };
      this.emitChanges({ moved });
    },

    computeFutureIndex(relatedContext, evt) {
      if (!relatedContext.element) {
        return 0;
      }
      const domChildren = [...evt.to.children].filter(
        el => el.style["display"] !== "none"
      );
      const currentDomIndex = domChildren.indexOf(evt.related);
      const currentIndex = relatedContext.component.getVmIndexFromDomIndex(
        currentDomIndex
      );
      const draggedInList = domChildren.indexOf(draggingElement) !== -1;
      return draggedInList || !evt.willInsertAfter
        ? currentIndex
        : currentIndex + 1;
    },

    onDragMove(evt, originalEvent) {
      const { move, realList } = this;
      if (!move || !realList) {
        return true;
      }

      const relatedContext = this.getRelatedContextFromMoveEvent(evt);
      const futureIndex = this.computeFutureIndex(relatedContext, evt);
      const draggedContext = {
        ...this.context,
        futureIndex
      };
      const sendEvent = {
        ...evt,
        relatedContext,
        draggedContext
      };
      return move(sendEvent, originalEvent);
    },

    onDragEnd() {
      this.computeIndexes();
      draggingElement = null;
    }
  }
});

export default draggableComponent;
