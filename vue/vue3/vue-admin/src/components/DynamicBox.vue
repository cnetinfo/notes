<template>
  <div class="box" :style="{ width: width + 'px' }"></div>
  <div class="box1"></div>
  <button @click="change">click</button>
</template>

<script setup>
import { ref } from 'vue'

const width = ref(100)

function change() {
  width.value += 100
}
</script>

<style scoped>
.box {
  background-color: red;
  height: 100px;
  transition: width 1s linear;
}

.box1 {
  width: 30px;
  height: 30px;
  position: relative;
  background: #d88986;
  animation: move 2s linear infinite;
}

@keyframes move {
  0% {
    left: 0px
  }

  50% {
    left: 200px
  }

  100% {
    left: 0
  }
}
</style>