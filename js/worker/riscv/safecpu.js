// -------------------------------------------------
// -------------------- CPU ------------------------
// -------------------------------------------------

"use strict";
var message = require('../messagehandler');
var utils = require('../utils');
var syscalls = require('./syscalls.js');

var CSR_MSTATUS = 0x300;
var CSR_CYCLES = 0xC00;
var CSR_CYCLEW = 0x900;
var CSR_MTOHOST =  0x780;
var CSR_MTOHOST_TEMP =  0x345; //only temporary for the patched pk.
var CSR_MFROMHOST =  0x781;
var CSR_MCPUID = 0xF00;
var CSR_MIMPID = 0xF01;
var CSR_MHARTID = 0xF10;
var CSR_MTVEC = 0x301;
var CSR_MIE = 0x304;
var CSR_MSCRATCH = 0x340;
var CSR_MEPC = 0x341;
var CSR_MCAUSE = 0x342;
var CSR_MBADADDR = 0x343;
var CSR_SSTATUS = 0x100;
var CSR_STVEC = 0x101;
var CSR_SIE = 0x104;
var CSR_TIME = 0xC01;

var CSR_SEPC = 0x141;
var CSR_HEPC = 0x241;
var CSR_MEPC = 0x341;
var PRV_U = 0x00;
var PRV_S = 0x01;
var PRV_H = 0x02;
var PRV_M = 0x03;

var VM_READ = 0;
var VM_WRITE = 1;
var VM_FETCH = 2;

var SYS_OPENAT = 56;
var SYS_CLOSE = 57;
var SYS_PREAD = 67;
var SYS_WRITE = 64;
var SYS_FSTAT = 80;
var SYS_EXIT = 93;
var SYS_GETMAINVARS = 2011;

var CAUSE_TIMER_INTERRUPT = (1<<31) | 0x01;
var CAUSE_SOFTWARE_INTERRUPT = (1<<31);
var CAUSE_INSTRUCTION_ACCESS_FAULT = 0x01;
var CAUSE_ILLEGAL_INSTRUCTION = 0x02;
var CAUSE_BREAKPOINT = 0x03;
var CAUSE_LOAD_ACCESS_FAULT = 0x05;
var CAUSE_STORE_ACCESS_FAULT = 0x07;
var CAUSE_ENVCALL_UMODE = 0x08;
var CAUSE_ENVCALL_SMODE = 0x09;
var CAUSE_ENVCALL_HMODE = 0x0A;
var CAUSE_ENVCALL_MMODE = 0x0B;


var CSR_FFLAGS = 0x1;
var CSR_FRM = 0x2;
var CSR_FCSR = 0x3;
var CSR_INSTRET = 0xC02;
var CSR_STATS = 0xC0;
var CSR_UARCH0 = 0xCC0;
var CSR_UARCH1 = 0xCC1;
var CSR_UARCH2 = 0xCC2;
var CSR_UARCH3 = 0xCC3;
var CSR_UARCH4 = 0xCC4;
var CSR_UARCH5 = 0xCC5;
var CSR_UARCH6 = 0xCC6;
var CSR_UARCH7 = 0xCC7;
var CSR_UARCH8 = 0xCC8;
var CSR_UARCH9 = 0xCC9;
var CSR_UARCH10 = 0xCCA;
var CSR_UARCH11 = 0xCCB;
var CSR_UARCH12 = 0xCCC;
var CSR_UARCH13 = 0xCCCD;
var CSR_UARCH14 = 0xCCCE;
var CSR_UARCH15 = 0xCCCF;
var CSR_STVEC = 0x101;
var CSR_SIE = 0x104;
var CSR_STIMECMP = 0x121;
var CSR_SSCRATCH = 0x140;
var CSR_SEPC = 0x141;
var CSR_SIP = 0x144;
var CSR_SPTBR = 0x180;
var CSR_SASID = 0x181;
var CSR_TIMEW = 0x901;
var CSR_INSTRETW = 0x902;
var CSR_STIME = 0xD01;
var CSR_SCAUSE = 0xD42;
var CSR_SBADADDR = 0xD43;
var CSR_STIMEW = 0xA01;
var CSR_MTVEC = 0x301;
var CSR_MTDELEG = 0x302;
var CSR_MIE = 0x304;
var CSR_MTIMECMP = 0x321;
var CSR_MBADADDR = 0x343;
var CSR_MIP = 0x344;
var CSR_MTIME = 0x701;
var CSR_MCPUID = 0xF00;
var CSR_MIMPID = 0xF01;
var CSR_MHARTID = 0xF10;
var CSR_MTOHOST = 0x780;
var CSR_MFROMHOST = 0x781;
var CSR_MRESET = 0x782;
var CSR_SEND_IPI = 0x783;
var CSR_CYCLEH = 0xC80;
var CSR_TIMEH = 0xC81;
var CSR_INSTRETH = 0xC82;
var CSR_CYCLEHW = 0x980;
var CSR_TIMEHW = 0x981;
var CSR_INSTRETHW = 0x982;
var CSR_STIMEH = 0xD81;
var CSR_STIMEHW = 0xA81;
var CSR_MTIMEH = 0x741;

// constructor
function SafeCPU(ram) {
    message.Debug("Initialize RISCV CPU");

    this.ram = ram;
    // registers
    // r[32] and r[33] are used to calculate the virtual address and physical address
    // to make sure that they are not transformed accidently into a floating point number
    this.r = new Int32Array(this.ram.heap, 0, 34 << 2);
    this.f = new Float64Array(this.ram.heap, 32<<2, 32); 
    this.fi = new Int32Array(this.ram.heap, 32<<2, 32<<1); // for copying operations
    this.ff = new Float32Array(this.ram.heap, 0, 1); // the zero register is used to convert to single precision
    this.csr = new Int32Array(this.ram.heap, 0x2000, 4096 << 2);
    this.pc = 0x200;

    this.Reset();
}

SafeCPU.prototype.Reset = function() {
    this.ticks = 0;
    this.csr[CSR_MSTATUS] = 0x96; // 1001 0110 - All Interrupts Disabled, FPU disabled 
    this.csr[CSR_MTOHOST] =  0x780;
    this.csr[CSR_MCPUID] = 0x4112D;
    this.csr[CSR_MIMPID] = 0x01;
    this.csr[CSR_MHARTID] = 0x00;
    this.csr[CSR_MTVEC] = 0x100;
    this.csr[CSR_MIE] = 0x00;
    this.csr[CSR_MEPC] = 0x00;
    this.csr[CSR_MCAUSE] = 0x00;
    this.csr[CSR_MBADADDR] = 0x00;
    this.csr[CSR_SSTATUS] = 0x3010;
    this.csr[CSR_STVEC] = 0x00;
    this.csr[CSR_SIE] = 0x00;
    this.csr[CSR_TIME] = 0X64;
    this.csr[CSR_SPTBR] = 0x40000;

    this.amoaddr = 0x00; 
    this.amovalue = 0x00;
    this.ram.Write32(0x00,31*1024*1024); //Writing the amount of free memory available into the first memory location

    this.syscallHandler = new syscalls(this.ram,this.csr);
}

SafeCPU.prototype.InvalidateTLB = function() {
}

SafeCPU.prototype.GetTimeToNextInterrupt = function () {
    return 10;
}

SafeCPU.prototype.GetTicks = function () {
    return this.ticks;
}

SafeCPU.prototype.ProgressTime = function (delta) {
    this.ticks += delta;
}


SafeCPU.prototype.AnalyzeImage = function() // we haveto define these to copy the cpus
{
}

SafeCPU.prototype.CheckForInterrupt = function () {
};

SafeCPU.prototype.RaiseInterrupt = function (line, cpuid) {
};

SafeCPU.prototype.ClearInterrupt = function (line, cpuid) {
};

SafeCPU.prototype.Disassemble = function (ins) {

    var r = this.r;
    var fi = this.fi;
    var ff = this.ff;
    var f = this.f;
    var csr = this.csr;
    var rindex = 0x00;
    var findex = 0x00;
    var imm = 0x00;
    var imm1 = 0x00;
    var imm2 = 0x00;
    var imm3 = 0x00;
    var imm4 = 0x00;
    var zimm = 0x00;
    var rs1 = 0x00;
    var rs2 = 0x00;
    var fs1 = 0x00;
    var fs2 = 0x00;

    switch(ins&0x7F) {

        case 0x03:
            //lb,lh,lw,lbu,lhu
            switch((ins >> 12)&0x7) {
                
                case 0x00:
                    //lb
                    message.Debug("lb - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x01:
                    //lh
                    message.Debug("lh - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x02:
                    //lw
                    message.Debug("lw - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x04:
                    //lbu
                    message.Debug("lbu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x05:
                    //lhu
                    message.Debug("lhu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                default:
                    message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                    break;

            }
            break;

        case 0x23:
            //sb,sh,sw
            switch((ins >> 12)&0x7) {
                
                case 0x00:
                    //sb
                    message.Debug("sb - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x01:
                    //sh
                    message.Debug("sh - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x02:
                    //sw
                    message.Debug("sw - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                default:
                    message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                    break;

            }
            break;

        case 0x13:
            //addi,slti,sltiu,xori,ori,andi,slli,srli,srai
            switch((ins >> 12)&0x7) {
                
                case 0x00:
                    //addi
                    message.Debug("addi - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x02:
                    //slti
                    message.Debug("slti - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x03:
                    //sltiu
                    message.Debug("sltiu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x04:
                    //xori
                    message.Debug("xori - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x06:
                    //ori
                    message.Debug("ori - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x07:
                    //andi
                    message.Debug("andi - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x01:
                    //slli
                    message.Debug("slli - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x05:
                    if(((ins >> 25) & 0x7F) == 0x00){
                        //srli
                        message.Debug("srli - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    }
                    else if(((ins >> 25) & 0x7F) == 0x20){
                        //srai
                        message.Debug("srai - "+ utils.ToHex(ins)+" register " + r[rindex]);  
                    }
                    break;

                default:
                    message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                    break;

            }
            break;

        case 0x33:
            //add,sub,sll,slt,sltu,xor,srl,sra,or,and
            switch((ins >> 25)&0x7F) {
                
                case 0x00:
                    //add,slt,sltu,add,or,xor,sll,srl
                    switch((ins >> 12)&0x7) {
                        case 0x00:
                            //add
                            message.Debug("add - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x02:
                            //slt
                            message.Debug("slt - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x03:
                            //sltu
                            message.Debug("sltu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x07:
                            //and
                            message.Debug("and - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x06:
                            //or
                            message.Debug("or - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x04:
                            //xor
                            message.Debug("xor - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x01:
                            //sll
                            message.Debug("sll - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x05:
                            //srl
                            message.Debug("srl - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;
                    }
                    break;

                case 0x20:
                    //sub
                    switch((ins >> 12)&0x7) {
                        case 0x00:
                            //sub
                            message.Debug("sub - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x05:
                            //sra
                            message.Debug("sra - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;
                    }
                    break;

                case 0x01:
                    //mul,mulh,mulhsu,mulhu,div,divu,rem,remu
                    switch((ins >> 12)&0x7) {
                        case 0x00:
                            //mul
                            message.Debug("mul - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x01:
                            //mulh
                            message.Debug("mulh - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x02:
                            //mulhsu
                            message.Debug("mulhsu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x03:
                            //mulhu
                            message.Debug("mulhu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x04:
                            //div
                            message.Debug("div - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x05:
                            //divu
                            message.Debug("divu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x06:
                            //rem
                            message.Debug("rem - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;

                        case 0x07:
                            //remu
                            message.Debug("remu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                            break;
                    }
                    break;

                

                default:
                    message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                    break;

            }
            break;

        case 0x37:
            //lui
            message.Debug("Lui - "+ utils.ToHex(ins)+" register " + r[rindex]);
            break;

        case 0x17:
            //auipc
            message.Debug("auipc - "+ utils.ToHex(ins)+" register " + r[rindex]);
            break;

        case 0x6F:
            //jal
            message.Debug("jal - "+ utils.ToHex(ins)+" register " + r[rindex]);
            break; 

        case 0x67:
            //jalr
            message.Debug("jalr - "+ utils.ToHex(ins)+" register " + r[rindex]);
            break;

        case 0x63:
            //beq,bne,blt,bge,bltu,bgeu
            switch((ins >> 12)&0x7) {
                
                case 0x00:
                    //beq
                    message.Debug("beq - "+ utils.ToHex(ins)+" register " + utils.ToHex(rs1));
                    break;

                case 0x01:
                    //bne
                    message.Debug("bne - "+ utils.ToHex(rs2)+" register " + utils.ToHex((ins >> 20) & 0x1F));
                    break;

                case 0x04:
                    //blt
                    message.Debug("blt - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x05:
                    //bge
                    message.Debug("bge - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x06:
                    //bltu
                    message.Debug("bltu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x07:
                    //bgeu
                    message.Debug("bgeu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                default:
                    message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                    break;

            }
            break;

        case 0x73:
            //csrrw,csrrs,csrrc,csrrwi,csrrsi,csrrci,ecall,eret,ebreak,mrts
            switch((ins >> 12)&0x7) {
                
                case 0x01:
                    //csrrw
                    message.Debug("csrrw - "+ utils.ToHex(ins)+" rs1 "+utils.ToHex(rs1)+" imm " + csr[imm]);
                    break;

                case 0x02:
                    //csrrs
                    message.Debug("csrrs - "+ utils.ToHex(ins)+" rs1 "+utils.ToHex(rs1)+" imm " + csr[imm]);
                    break;

                case 0x03:
                    //csrrc
                    message.Debug("csrrc - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x05:
                    //csrrwi
                    message.Debug("csrrwi - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;
                    

                case 0x06:
                    //csrrsi
                    message.Debug("csrrsi - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x07:
                    //csrrci
                    message.Debug("csrrci - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;
                
                case 0x00:
                    //ecall,eret,ebreak,mrts
                    switch((ins >> 20)&0xFFF) {
                        case 0x00:
                            //ecall
                            var current_privilege_level = (csr[CSR_MSTATUS] & 0x06) >> 1;
                            switch(current_privilege_level)
                            {
                                case PRV_U:
                                    message.Debug("ecall PRV_U -"+ utils.ToHex(ins));
                                    break;

                                case PRV_S:
                                    message.Debug("ecall PRV_S -"+ utils.ToHex(ins));
                                    break;

                                case PRV_H:
                                    message.Debug("Not supported ecall PRV_H -"+ utils.ToHex(ins));
                                    break;

                                case PRV_M:
                                    message.Debug("ecall PRV_M -"+ utils.ToHex(ins));
                                    break;
                                
                                default:
                                    message.Debug("Error in ecall: Don't know how to handle privilege level " + current_privilege_level);
                                    break;
                            }
                            break;

                        case 0x001:
                            //ebreak
                            message.Debug("ebreak - "+ utils.ToHex(ins)+" at PC" + utils.ToHex(this.pc));
                            break;

                        case 0x100:
                            //eret
                            var current_privilege_level = (csr[CSR_MSTATUS] & 0x06) >> 1;
                            if(current_privilege_level < PRV_S) {
                                message.Debug("Error in eret: current_privilege_level isn't allowed access");
                                break;   
                            }
                            switch(current_privilege_level)
                            {
                                
                                case PRV_S:
                                    message.Debug("eret PRV_S -"+ utils.ToHex(ins));
                                    break;

                                case PRV_H:
                                    message.Debug("Not supported eret PRV_H -"+ utils.ToHex(ins));
                                    break;

                                case PRV_M:
                                    message.Debug("eret PRV_M -"+ utils.ToHex(ins));
                                    break;
                                
                                default:
                                    message.Debug("Error in eret: Don't know how to handle privilege level " + current_privilege_level);
                                    break;
                            }
                            break;

                        case 0x305:
                            //mrts     
                            if(current_privilege_level != PRV_M) {
                                message.Debug("Error in mrts: current_privilege_level isn't allowed access");
                                break;   
                            }
                            message.Debug("mrts - "+ utils.ToHex(ins)+" at PC" + utils.ToHex(this.pc));
                            break;

                        case 0x101:
                            //sfence.vm
                            message.Debug("sfence.vm - "+ utils.ToHex(ins)+" at PC" + utils.ToHex(this.pc));
                            break;

                        default:
                            message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                            break;

                    }
                    break; 

                default:
                    message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                    break;

            }
            break;

        case 0x07:
            //flw,fld
            switch((ins >> 12)&0x7) {
                
                case 0x02:
                    //flw
                    message.Debug("flw - "+ utils.ToHex(ins)+" register " + f[findex]);
                    break;

                case 0x03:
                    //fld
                    message.Debug("fld - "+ utils.ToHex(ins)+" register " + fi[findex]);
                    break;

                default:
                    message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                    break;

            }
            break;

        case 0x27:
            //fsw,fsd
            switch((ins >> 12)&0x7) {

                case 0x02:
                    //fsw
                    message.Debug("fsw - "+ utils.ToHex(ins)+" register " + f[findex]);
                    break;

                case 0x03:
                    //fsd
                    message.Debug("fsw - "+ utils.ToHex(ins)+" register " + fi[findex]);
                    break;

                default:
                    message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                    break;

            }
            break;

        case 0x53:
            //fadd.s,fsub.s
            switch((ins >> 25)&0x7F) {
                
                case 0x00 :
                    //fadd.s
                    message.Debug("fadd.s - "+ utils.ToHex(ins)+" register " + f[rindex]);
                    break;

                case 0x04:
                    //fsub.s
                    message.Debug("fsub.s - "+ utils.ToHex(ins)+" register " + f[rindex]);
                    break;

                case 0x60:
                    //fcvt.w.s
                    message.Debug("fcvt.w.s - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x01 :
                    //fadd.d
                    message.Debug("fadd.d - "+ utils.ToHex(ins)+" register " + f[rindex]);
                    break;

                case 0x05:
                    //fsub.d
                    message.Debug("fsub.d - "+ utils.ToHex(ins)+" register " + f[rindex]);
                    break;

                case 0x61:
                    //fcvt.w.d
                    message.Debug("fcvt.w.s - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x78:
                    //fmv.s.x
                    message.Debug("fmv.s.x - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;


                default:
                    message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                    break;
            }
            break;

        case 0x2F:
            //amoswap,amoadd,amoxor,amoand,amoor,amomin,amomax,amominu,amomaxu
            switch((ins >> 27)&0x1F) {
                
                case 0x01:
                    //amoswap
                    message.Debug("amoswap - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x00:
                    //amoadd
                    message.Debug("amoadd - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x04:
                    //amoxor
                    message.Debug("amoxor - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x0C:
                    //amoand
                    message.Debug("amoand - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x08:
                    //amoor
                    message.Debug("amoor - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x10:
                    //amomin
                    message.Debug("amomin - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

               case 0x14:
                    //amomax
                    message.Debug("amomax - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x18:
                    //amominu
                    message.Debug("amominu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x1C:
                    //amomaxu
                    message.Debug("amomaxu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x02:
                    //lr.d
                    message.Debug("lr.d - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                case 0x03:
                    //sc.d
                    message.Debug("sc.d - "+ utils.ToHex(ins)+" register " + r[rindex]);
                    break;

                default:
                    message.Debug("Error in Atomic Memory Instruction " + utils.ToHex(ins) + "not found");
                    break;

            }
            break;

        case 0x0F:
            //fence
            message.Debug("fence - "+ utils.ToHex(ins)+" at PC" + utils.ToHex(this.pc));
            break;

        default:
            message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + " not found at "+utils.ToHex(this.pc));
            break;
    }

    message.Debug(utils.ToHex(this.pc));
};

SafeCPU.prototype.CheckVMPrivilege = function (type, op) {

    var priv = (this.csr[CSR_MSTATUS] & 0x06) >> 1;

    if (type == 7) return true;
    if ((type == 15) && (priv == PRV_S)) return true;
    if ((type == 13) && (priv == PRV_S) && (op != VM_FETCH)) return true;
    if ((type == 14) && (priv == PRV_S) && (op != VM_WRITE)) return true;

    message.Debug("Inside CheckVMPrivilege for PC "+this.pc + " and type " + type + " and op " + op);
    message.Abort();
    return false;
}

SafeCPU.prototype.TranslateVM = function (addr,op) {

    var vm = (this.csr[CSR_MSTATUS] >> 17) & 0x1F;
    var current_privilege_level = (this.csr[CSR_MSTATUS] & 0x06) >> 1;
    var i = 1; //i = LEVELS -1 and LEVELS = 2 in a 32 bit System

    // vm bare mode
    if(vm == 0 || current_privilege_level == PRV_M) return addr;

    if ((addr>>>28) == 0x9) return addr;

    // only RV32 supported
    if(vm != 8) {
        message.Debug("unkown VM Mode " + vm + " at PC " + utils.ToHex(this.pc));
        message.Abort();
    }

    // LEVEL 1
    //var offset = addr & 0x3FFFFF;
    var offset = addr & 0xFFF;
    var page_num = (addr >> 22) & 0x3FF;

    var frame_num = this.ram.Read32(this.csr[CSR_SPTBR] + (page_num << 2));
    var type = ((frame_num >> 1) & 0xF);
    var valid = (frame_num & 0x01);

    if (valid == 0) {
        //message.Debug("Unsupported valid field " + valid + " or invalid entry in PTE at PC " + utils.ToHex(this.pc) + " and addr " + utils.ToHex(addr));

        this.csr[CSR_MBADADDR] = addr;
        if(op == VM_READ) this.Trap(CAUSE_LOAD_ACCESS_FAULT);
        else if(op == VM_WRITE) this.Trap(CAUSE_STORE_ACCESS_FAULT);
        else this.Trap(CAUSE_INSTRUCTION_ACCESS_FAULT);
        return -1;

        //message.Abort();

    }
    if (type >= 2) {
        if (!this.CheckVMPrivilege(type,op)) {
            message.Debug("Error in TranslateVM: Unhandled trap");
            message.Abort();
        }

        //message.Debug("Superpage mapping at pc="+utils.ToHex(this.pc) + " to " + utils.ToHex(frame_num));
        //message.Abort();

/*
        var updated_frame_num = frame_num;
        if(op == VM_READ)
            updated_frame_num = (frame_num | 0x20);
        else if(op == VM_WRITE)
            updated_frame_num = (frame_num | 0x60);
        this.ram.Write32(this.csr[CSR_SPTBR] + (page_num << 2),updated_frame_num);
*/
        //var physical_addr = (frame_num & 0xFFC00000) | offset;
        var physical_addr = (((frame_num >> 10) | ((addr >> 12) & 0x3FF)) << 12) | offset;
        return physical_addr;
    }

    // LEVEL 2
    //message.Debug("Second level MMU");
    i = i - 1;
    var offset = addr & 0xFFF;
    var new_sptbr = (frame_num & 0xFFFFFC00) << 2;
    var new_page_num = (addr >> 12) & 0x3FF;
    var new_frame_num = this.ram.Read32(new_sptbr + (new_page_num << 2));
    var new_type = ((new_frame_num >> 1) & 0xF);
    var new_valid = (new_frame_num & 0x01);

    if (new_valid == 0) {
        this.csr[CSR_MBADADDR] = addr;
        if(op == VM_READ) this.Trap(CAUSE_LOAD_ACCESS_FAULT);
            else if(op == VM_WRITE) this.Trap(CAUSE_STORE_ACCESS_FAULT);
            else this.Trap(CAUSE_INSTRUCTION_ACCESS_FAULT);
            return -1;
    }

    if (!this.CheckVMPrivilege(new_type, op)) {
        message.Debug("Error in TranslateVM: Unhandled trap");
        message.Abort();
    }
/*
    var updated_frame_num = new_frame_num;
    if(op == VM_READ)
        updated_frame_num = (new_frame_num | 0x20);
    else if(op == VM_WRITE)
        updated_frame_num = (new_frame_num | 0x60);
    this.ram.Write32(new_sptbr + (new_page_num << 2),updated_frame_num);
*/
    //var physical_addr = (new_frame_num & 0xFFFFF000) | offset;
    var physical_addr = ((new_frame_num >> 10) << 12) | offset;
    return physical_addr;
};

SafeCPU.prototype.SetCSR = function (addr,value) {

    var csr = this.csr;

    switch(addr)
    {
        case CSR_MTOHOST:
            if(value > 0x100){
                csr[addr] =  value;
                this.syscallHandler.HandleSysCall();
            }
            else
                this.ram.Write8Little(0x90000000 >> 0, value+0x30);
            break;

        case CSR_MTOHOST_TEMP: //only temporary for the patched pk.
            this.ram.Write8Little(0x90000000 >> 0, value);
            if (value == 0xA) this.ram.Write8(0x90000000 >> 0, 0xD);
            break;

        case CSR_MFROMHOST:
            csr[addr] = value;
            break;

        case CSR_MSTATUS:
            csr[addr] = value;
            break;

        case CSR_MCPUID:
            //message.Debug("Error: Cannot write into CSR_CYCLES at "+utils.ToHex(addr));
            //this.Trap(CAUSE_ILLEGAL_INSTRUCTION);
            //csr[addr] = value;
            break;

        case CSR_MIMPID:
            csr[addr] = value;
            break;

        case CSR_MHARTID:
            csr[addr] = value;
            break;

        case CSR_MTVEC:
            csr[addr] = value;
            break;

        case CSR_MIP:
            //csr[addr] = value;
            var mask = 0x2 | 0x08; //mask = MIP_SSIP | MIP_MSIP
            csr[CSR_MIP] = (csr[CSR_MIP] & ~mask) | (value & mask);
            break;

        case CSR_MIE:
            //csr[addr] = value;
            var mask = 0x2 | 0x08 | 0x20; //mask = MIP_SSIP | MIP_MSIP | MIP_STIP
             csr[CSR_MIE] = (csr[CSR_MIE] & ~mask) | (value & mask);
            break;

        case CSR_SEPC:
        case CSR_MEPC:
            csr[addr] = value;
            break;

        case CSR_MCAUSE:
            csr[addr] = value;
            break;

        case CSR_SCAUSE:
            csr[addr] = value;
            break;

        case CSR_MBADADDR:
            csr[addr] = value;
            break;

        case CSR_SBADADDR:
            csr[addr] = value;
            break;

        case CSR_SSTATUS:
            csr[addr] = value;
            csr[CSR_MSTATUS] &= ~0x1F039; 
            csr[CSR_MSTATUS] |= (csr[CSR_SSTATUS] & 0x01); //IE0
            csr[CSR_MSTATUS] |= (csr[CSR_SSTATUS] & 0x08); //IE1
            csr[CSR_MSTATUS] |= (csr[CSR_SSTATUS] & 0x10); //PRV1
            csr[CSR_MSTATUS] |= (csr[CSR_SSTATUS] & 0xF000); //FS,XS
            csr[CSR_MSTATUS] |= (csr[CSR_SSTATUS] & 0x10000); //MPRV
            break; 

        case CSR_STVEC:
            csr[addr] = value;
            break;

        case CSR_SIP:
            //csr[addr] = value;
            var mask = 0x2; //mask = MIP_SSIP
            csr[CSR_MIP] = (csr[CSR_MIP] & ~mask) | (value & mask);
            break;

        case CSR_SIE:
            //csr[addr] = value;
            var mask = 0x2 | 0x20; //mask = MIP_SSIP | MIP_STIP
             csr[CSR_MIE] = (csr[CSR_MIE] & ~mask) | (value & mask);
            break;

        case CSR_MSCRATCH:
            csr[addr] = value;
            break;

        case CSR_SSCRATCH:
            csr[addr] = value;
            break;

        case CSR_CYCLEW:
            csr[addr] = value;
            break;

        case CSR_CYCLES:
            //message.Debug("Error: Cannot write into CSR_CYCLES at "+utils.ToHex(addr));
            //this.Trap(CAUSE_ILLEGAL_INSTRUCTION);
            this.ticks = value;
            csr[addr] = value;
            break;

        case CSR_MTIME:
        case CSR_STIME:
        case CSR_STIMEW:
            csr[addr] = value;
            break;

        case CSR_MTIMEH:
        case CSR_STIMEH:
        case CSR_STIMEHW:
            csr[addr] = value;
            break;

        case CSR_TIME:
        case CSR_TIMEW:
            csr[addr] = value;
            break;

        case CSR_MTIMECMP:
        case CSR_STIMECMP:
            csr[CSR_MIP] &= ~(0x20); //csr[CSR_MIP] &= ~MIP_STIP
            csr[addr] = value;
            break;

        case CSR_SPTBR:
            csr[addr] = value;
            break;

        default:
            csr[addr] = value;
            message.Debug("Error in SetCSR: PC "+utils.ToHex(this.pc)+" Address " + utils.ToHex(addr) + " unkown");
            message.Abort();
            break;
    }
};

SafeCPU.prototype.GetCSR = function (addr) {

    var csr = this.csr;
    var current_privilege_level = (csr[CSR_MSTATUS] & 0x06) >> 1;

    switch(addr)
    {
        case CSR_MTOHOST:
            return 0x0;
            break;

        case CSR_MTOHOST_TEMP: //only temporary for the patched pk.
            return 0x0;
            break;

        case CSR_MFROMHOST:
            return csr[addr];
            break;

        case CSR_MSTATUS:
            if (current_privilege_level == 0) this.Trap(CAUSE_ILLEGAL_INSTRUCTION);
            return csr[addr];
            break;

        case CSR_MCPUID:
            return csr[addr];
            break;

        case CSR_MIMPID:
            return csr[addr];
            break;

        case CSR_MHARTID:
            return csr[addr];
            break;

        case CSR_MTVEC:
            return csr[addr];
            break;

        case CSR_MIE:
            return csr[addr];
            break;

        case CSR_SEPC:
        case CSR_MEPC:
            return csr[addr];
            break;

        case CSR_MCAUSE:
            return csr[addr];
            break;

        case CSR_SCAUSE:
            return csr[addr];
            break;

        case CSR_MBADADDR:
            return csr[addr];
            break;

        case CSR_SBADADDR:
            return csr[addr];
            break;

        case CSR_SSTATUS:
            //if (current_privilege_level == 0) this.Trap(CAUSE_ILLEGAL_INSTRUCTION);
            csr[CSR_SSTATUS] = 0x00; 
            csr[CSR_SSTATUS] |= (csr[CSR_MSTATUS] & 0x01); //IE0
            csr[CSR_SSTATUS] |= (csr[CSR_MSTATUS] & 0x08); //IE1
            csr[CSR_SSTATUS] |= (csr[CSR_MSTATUS] & 0x10); //PRV1
            csr[CSR_SSTATUS] |= (csr[CSR_MSTATUS] & 0xF000); //FS,XS
            csr[CSR_SSTATUS] |= (csr[CSR_MSTATUS] & 0x10000); //MPRV
            return csr[CSR_SSTATUS];
            break;

        case CSR_STVEC:
            return csr[addr];
            break;

        case CSR_MIP:
            return csr[addr];

        case CSR_MIE:
            return csr[addr];

        case CSR_SIP: return csr[CSR_MIP] & (0x2 | 0x20);//(MIP_SSIP | MIP_STIP)
        case CSR_SIE: return csr[CSR_MIE] & (0x2 | 0x20);//(MIP_SSIP | MIP_STIP)

        case CSR_MSCRATCH:
            return csr[addr];
            break;

        case CSR_SSCRATCH:
            return csr[addr];
            break;

        case CSR_CYCLEW:
            return this.ticks;
            break;

        case CSR_CYCLES:
            return this.ticks;
            break;

        case CSR_MTIME:
        case CSR_STIME:
        case CSR_STIMEW:
            return this.ticks;//*2*Math.pow(10, 7);
            break;

        case CSR_MTIMEH:
        case CSR_STIMEH:
        case CSR_STIMEHW:
            return (this.ticks) >> 32;
            break;

        case CSR_TIME:
        case CSR_TIMEW:
            return this.ticks;//*2*Math.pow(10, 7);
            break;

        case CSR_MTIMECMP:
        case CSR_STIMECMP:
            return csr[addr];
            break;
        
        case CSR_SPTBR:
            return csr[addr];
            break;

        default:
            message.Debug("Error in GetCSR: PC "+utils.ToHex(this.pc)+" Address " + utils.ToHex(addr) + " unkown");
            message.Abort();
            return csr[addr];
            break;
    }
   
};

SafeCPU.prototype.IMul = function (a,b) {

    var result = [0,0];

    a >>>= 0;
    b >>>= 0;

    if (a < 32767 && b < 65536) {
        result[0] = a * b;
        result[1] = (result[0] < 0) ? -1 : 0;
        return result;
    }

    var a00 = a & 0xFFFF, a16 = a >>> 16;
    var b00 = b & 0xFFFF, b16 = b >>> 16;

    var c00 = a00 * b00;
    var c16 = (c00 >>> 16) + (a16 * b00);
    var c32 = c16 >>> 16;
    c16 = (c16 & 0xFFFF) + (a00 * b16);
    c32 += c16 >>> 16;
    var c48 = c32 >>> 16;
    c32 = (c32 & 0xFFFF) + (a16 * b16);
    c48 += c32 >>> 16;

    result[0] = ((c16 & 0xFFFF) << 16) | (c00 & 0xFFFF);
    result[1] = ((c48 & 0xFFFF) << 16) | (c32 & 0xFFFF);
    return result;
};

SafeCPU.prototype.UMul = function (a,b) {

    var result = [0,0];

    if (a == 0) return result[0] = result[1] = 0, result;
    if (b == 0) return result[0] = result[1] = 0, result;

    a |= 0;
    b |= 0;

    if ((a >= -32768 && a <= 32767) && (b >= -32768 && b <= 32767)) {
        result[0] = a * b;
        result[1] = (result[0] < 0) ? -1 : 0;
        return result;
    }

    var doNegate = (a < 0) ^ (b < 0);

    result = this.IMul(Math.abs(a), Math.abs(b));

    if (doNegate) {
        result[0] = ~result[0];
        result[1] = ~result[1];
        result[0] = (result[0] + 1) | 0;
        if (result[0] == 0) result[1] = (result[1] + 1) | 0;
    }

    return result;
};

SafeCPU.prototype.SUMul = function (a,b) {

    var result = [0,0];

    if (a == 0) return result[0] = result[1] = 0, result;
    if (b == 0) return result[0] = result[1] = 0, result;

    a |= 0;
    b >>>= 0;

    if ((a >= -32768 && a <= 32767) && (b >= -32768 && b <= 32767)) {
        result[0] = a * b;
        result[1] = (result[0] < 0) ? -1 : 0;
        return result;
    }

    var doNegate = (a < 0) ^ (b < 0);

    result = this.IMul(Math.abs(a), Math.abs(b));

    if (doNegate) {
        result[0] = ~result[0];
        result[1] = ~result[1];
        result[0] = (result[0] + 1) | 0;
        if (result[0] == 0) result[1] = (result[1] + 1) | 0;
    }

    return result;
};

SafeCPU.prototype.Trap = function (cause) {

    var current_privilege_level = (this.csr[CSR_MSTATUS] & 0x06) >> 1;
    this.PushPrivilegeStack(PRV_M);
    this.csr[CSR_MEPC] = this.pc;
    this.csr[CSR_MCAUSE] = cause;
    this.pc =  0x100 + 0x40*current_privilege_level - 4|0;  

};

SafeCPU.prototype.PushPrivilegeStack = function (prv) {

    var csr = this.csr;
    var mstatus = csr[CSR_MSTATUS];
    var privilege_level_stack =  (mstatus & 0xFFF);
    var new_privilege_level_stack = (((privilege_level_stack << 2) | prv) << 1) & 0xFFF;
    csr[CSR_MSTATUS] = (((mstatus >> 12) << 12) + new_privilege_level_stack) & 0xFFFEFFFF; //Last "and" to set mprv(bit 16) to zero
};

SafeCPU.prototype.PopPrivilegeStack = function (prv) {

    var csr = this.csr;
    var mstatus = csr[CSR_MSTATUS];
    var privilege_level_stack =  (mstatus & 0xFFF);
    var new_privilege_level_stack = ((privilege_level_stack >>> 3) | ((prv << 1) | 0x1) << 9);
    csr[CSR_MSTATUS] = ((mstatus >> 12) << 12) + new_privilege_level_stack;
};

SafeCPU.prototype.Step = function (steps, clockspeed) {

    var r = this.r;
    var fi = this.fi;
    var ff = this.ff;
    var f = this.f;
    var csr = this.csr;
    var rindex = 0x00;
    var findex = 0x00;
    var imm = 0x00;
    var imm1 = 0x00;
    var imm2 = 0x00;
    var imm3 = 0x00;
    var imm4 = 0x00;
    var zimm = 0x00;
    var mul=0x00;
    var quo=0x00;
    var rem=0x00;
    var rs1 = 0x00;
    var rs2 = 0x00;
    var fs1 = 0x00;
    var fs2 = 0x00;
    // this is the way to write to the terminal
    //this.ram.Write8Little(0x90000000 >> 0, (this.ticks&63)+32);
    
    do {
        r[0] = 0x00;
        var current_privilege_level = (this.csr[CSR_MSTATUS] & 0x06) >> 1;
        if (this.ticks == csr[CSR_STIMECMP]) {
            csr[CSR_MIP] = csr[CSR_MIP] | 0x20;
        }
        var interrupts = csr[CSR_MIE] & csr[CSR_MIP];
        var ie = csr[CSR_MSTATUS] & 0x01;
        if (interrupts) {
            if ((current_privilege_level < 3) || ((current_privilege_level == 3) && ie)) {
                if (interrupts & 0x8) {
                    this.Trap(CAUSE_SOFTWARE_INTERRUPT);
                    this.pc = this.pc + 4|0;
                }
            }
            if ((current_privilege_level < 1) || ((current_privilege_level == 1) && ie)) {
                if (interrupts & 0x2) {
                    this.Trap(CAUSE_SOFTWARE_INTERRUPT);
                    this.pc = this.pc + 4|0;
                }
                if (interrupts & 0x20) {
                     this.Trap(CAUSE_TIMER_INTERRUPT);
                     this.pc = this.pc + 4|0;
                }
            }
        }
        var paddr = this.TranslateVM(this.pc,VM_FETCH);
        if(paddr == -1) {
            this.pc = this.pc + 4|0;
            return 0;
        }
        var ins = this.ram.Read32(paddr);
        //this.Disassemble(ins);

        switch(ins&0x7F) {

            case 0x03:
                //lb,lh,lw,lbu,lhu
                switch((ins >> 12)&0x7) {
                    
                    case 0x00:
                        //lb
                        imm = (ins >> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1 + imm,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = (this.ram.Read8(paddr) << 24) >> 24;
                        //message.Debug("lb - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x01:
                        //lh
                        imm = (ins >> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1 + imm,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = (this.ram.Read16(paddr) << 16) >> 16;
                        //message.Debug("lh - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x02:
                        //lw
                        imm = (ins >> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1 + imm,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = this.ram.Read32(paddr);
                        //message.Debug("lw - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x04:
                        //lbu
                        imm = (ins >> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1 + imm,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = (this.ram.Read8(paddr) >>> 0);
                        //message.Debug("lbu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        //if(rs1 + imm > 0x8b75) message.Abort();
                        break;

                    case 0x05:
                        //lhu
                        imm = (ins >> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1 + imm,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = (this.ram.Read16(paddr) >>> 0);
                        //message.Debug("lhu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    default:
                        //message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                        message.Abort();
                        break;

                }
                break;

            case 0x23:
                //sb,sh,sw
                switch((ins >> 12)&0x7) {
                    
                    case 0x00:
                        //sb
                        imm1 = (ins >> 25);
                        imm2 = (ins >> 7) & 0x1F;
                        imm = (imm1 << 5) + imm2;
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 20) & 0x1F;
                        paddr = this.TranslateVM(rs1 + imm,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write8(paddr,(r[rindex] & 0xFF));
                        //message.Debug("sb - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x01:
                        //sh
                        imm1 = (ins >> 25);
                        imm2 = (ins >> 7) & 0x1F;
                        imm = (imm1 << 5) + imm2;
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 20) & 0x1F;
                        paddr = this.TranslateVM(rs1 + imm,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write16(paddr,(r[rindex] & 0xFFFF));
                        //message.Debug("sh - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x02:
                        //sw
                        imm1 = (ins >> 25);
                        imm2 = (ins >> 7) & 0x1F;
                        imm = (imm1 << 5) + imm2;
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 20) & 0x1F;
                        paddr = this.TranslateVM(rs1 + imm,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,r[rindex]);
                        //message.Debug("sw - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    default:
                        //message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                        message.Abort();
                        break;

                }
                break;

            case 0x13:
                //addi,slti,sltiu,xori,ori,andi,slli,srli,srai
                switch((ins >> 12)&0x7) {
                    
                    case 0x00:
                        //addi
                        imm = (ins >> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = rs1 + imm;
                        //message.Debug("addi - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x02:
                        //slti
                        imm = (ins >> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        if(rs1 < imm) r[rindex] = 0x01;
                        else r[rindex] = 0x00;
                        //message.Debug("slti - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x03:
                        //sltiu
                        imm = (ins >>> 20) >>> 0;
                        rs1 = r[(ins >> 15) & 0x1F] >>> 0;
                        rindex = (ins >> 7) & 0x1F;
                        if(rs1 < imm) r[rindex] = 0x01;
                        else r[rindex] = 0x00;
                        //message.Debug("sltiu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x04:
                        //xori
                        imm = (ins >> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = rs1 ^ imm;
                        //message.Debug("xori - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x06:
                        //ori
                        imm = (ins >> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = rs1 | imm;
                        //message.Debug("ori - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x07:
                        //andi
                        imm = (ins >> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = rs1 & imm;
                        //message.Debug("andi - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x01:
                        //slli
                        imm = (ins >> 20) & 0x1F;
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = rs1 << imm;
                        //message.Debug("slli - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x05:
                        if(((ins >> 25) & 0x7F) == 0x00){
                            //srli
                            imm = (ins >> 20) & 0x1F;
                            rs1 = r[(ins >> 15) & 0x1F];
                            rindex = (ins >> 7) & 0x1F;
                            r[rindex] = rs1 >>> imm;
                            //message.Debug("srli - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        }
                        else if(((ins >> 25) & 0x7F) == 0x20){
                            //srai
                            imm = (ins >> 20) & 0x1F;
                            rs1 = r[(ins >> 15) & 0x1F];
                            rindex = (ins >> 7) & 0x1F;
                            r[rindex] = rs1 >> imm;
                            //message.Debug("srai - "+ utils.ToHex(ins)+" register " + r[rindex]);  
                        }
                        break;

                    default:
                        //message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                        message.Abort();
                        break;

                }
                break;

            case 0x33:
                //add,sub,sll,slt,sltu,xor,srl,sra,or,and
                switch((ins >> 25)&0x7F) {
                    
                    case 0x00:
                        //add,slt,sltu,add,or,xor,sll,srl
                        switch((ins >> 12)&0x7) {
                            case 0x00:
                                //add
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                r[rindex] = rs1 + rs2;
                                //message.Debug("add - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x02:
                                //slt
                                rs1 = r[(ins >> 15) & 0x1F] >> 0;
                                rs2 = r[(ins >> 20) & 0x1F] >> 0;
                                rindex = (ins >> 7) & 0x1F;
                                if(rs1 < rs2) r[rindex] = 0x01;
                                else r[rindex] = 0x00;
                                //message.Debug("slt - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x03:
                                //sltu
                                rs1 = r[(ins >> 15) & 0x1F] >>> 0;
                                rs2 = r[(ins >> 20) & 0x1F] >>> 0;
                                rindex = (ins >> 7) & 0x1F;
                                if(rs1 < rs2) r[rindex] = 0x01;
                                else r[rindex] = 0x00;
                                //message.Debug("sltu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x07:
                                //and
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                r[rindex] = rs1 & rs2;
                                //message.Debug("and - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x06:
                                //or
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                r[rindex] = rs1 | rs2;
                                //message.Debug("or - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x04:
                                //xor
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                r[rindex] = rs1 ^ rs2;
                                //message.Debug("xor - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x01:
                                //sll
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                r[rindex] = rs1 << (rs2 & 0x1F);
                                //message.Debug("sll - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x05:
                                //srl
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                r[rindex] = rs1 >>> (rs2 & 0x1F);
                                //message.Debug("srl - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;
                        }
                        break;

                    case 0x20:
                        //sub
                        switch((ins >> 12)&0x7) {
                            case 0x00:
                                //sub
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                r[rindex] = rs1 - rs2;
                                //message.Debug("sub - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x05:
                                //sra
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                r[rindex] = rs1 >> (rs2 & 0x1F);
                                //message.Debug("sra - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;
                        }
                        break;

                    case 0x01:
                        //mul,mulh,mulhsu,mulhu,div,divu,rem,remu
                        switch((ins >> 12)&0x7) {
                            case 0x00:
                                //mul
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                mul = rs1 * rs2;
                                r[rindex] = mul & 0xFFFFFFFF;
                                //message.Debug("mul - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x01:
                                //mulh
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                var result = this.UMul(rs1,rs2);
                                r[rindex] = result[1];
                                //message.Debug("mulh - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x02:
                                //mulhsu
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F] >>> 0;
                                rindex = (ins >> 7) & 0x1F;
                                var result = this.SUMul(rs1,rs2);
                                r[rindex] = result[1];
                                //message.Debug("mulhsu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x03:
                                //mulhu
                                rs1 = r[(ins >> 15) & 0x1F] >>> 0;
                                rs2 = r[(ins >> 20) & 0x1F] >>> 0;
                                rindex = (ins >> 7) & 0x1F;
                                var result = this.IMul(rs1,rs2);
                                r[rindex] = result[1];
                                //message.Debug("mulhu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x04:
                                //div
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                if(rs2 == 0)
                                    quo = -1;
                                else
                                    quo = rs1 / rs2;
                                r[rindex] = quo;
                                //message.Debug("div - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x05:
                                //divu
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                if(rs2 == 0)
                                    quo = 0xFFFFFFFF;
                                else
                                    quo = (rs1 >>> 0) / (rs2 >>> 0);
                                r[rindex] = quo;
                                //message.Debug("divu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x06:
                                //rem
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                if(rs2 == 0)
                                    rem = rs1;
                                else
                                    rem = rs1 % rs2;
                                r[rindex] = rem;
                                //message.Debug("rem - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;

                            case 0x07:
                                //remu
                                rs1 = r[(ins >> 15) & 0x1F];
                                rs2 = r[(ins >> 20) & 0x1F];
                                rindex = (ins >> 7) & 0x1F;
                                if(rs2 == 0)
                                    rem = (rs1 >>> 0);
                                else
                                    rem = (rs1 >>> 0) % (rs2 >>> 0);
                                r[rindex] = rem;
                                //message.Debug("remu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                                break;
                        }
                        break;

                    

                    default:
                        //message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                        message.Abort();
                        break;

                }
                break;

            case 0x37:
                //lui
                rindex = (ins >> 7) & 0x1F;
                r[rindex] = (ins & 0xFFFFF000);
                //message.Debug("Lui - "+ utils.ToHex(ins)+" register " + r[rindex]);
                break;

            case 0x17:
                //auipc
                imm = (ins & 0xFFFFF000);
                rindex = (ins >> 7) & 0x1F;
                r[rindex] = (imm + this.pc);
                //message.Debug("auipc - "+ utils.ToHex(ins)+" register " + r[rindex]);
                break;

            case 0x6F:
                //jal
                imm1 = (ins >> 21) & 0x3FF;
                imm2 = ((ins >> 20) & 0x01) << 10;
                imm3 = ((ins >> 12) & 0xFF) << 11;
                imm4 = ((ins >> 31) & 0x01) << 19;
                imm = (((imm1 + imm2 + imm3 +imm4) << 1) << 11) >> 11; 
                rindex = (ins >> 7) & 0x1F;
                r[rindex] = this.pc + 4;
                this.pc = this.pc + imm - 4|0;//-4 is a temp hack
                //message.Debug("jal - "+ utils.ToHex(ins)+" register " + r[rindex]);
                break; 

            case 0x67:
                //jalr
                imm = (ins >> 20);
                rs1 = r[(ins >> 15) & 0x1F];
                rindex = (ins >> 7) & 0x1F;
                r[rindex] = this.pc + 4;
                this.pc = ((rs1 + imm) & 0xFFFFFFFE) - 4|0;//-4 is a temp hack
                //message.Debug("jalr - "+ utils.ToHex(ins)+" register " + r[rindex]);
                break;

            case 0x63:
                //beq,bne,blt,bge,bltu,bgeu
                switch((ins >> 12)&0x7) {
                    
                    case 0x00:
                        //beq
                        imm1 = (ins >> 31) << 11;
                        imm2 = ((ins >> 25) & 0x3F) << 4;
                        imm3 = (ins >> 8) & 0x0F;
                        imm4 = ((ins >> 7) & 0x01) << 10;
                        imm = (((imm1 + imm2 + imm3 + imm4) << 1 ) << 19) >> 19;
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        if(rs1 == rs2) this.pc = this.pc + imm - 4|0;//-4 temporary hack
                        //message.Debug("beq - "+ utils.ToHex(ins)+" register " + utils.ToHex(rs1));
                        break;

                    case 0x01:
                        //bne
                        imm1 = (ins >> 31) << 11;
                        imm2 = ((ins >> 25) & 0x3F) << 4;
                        imm3 = (ins >> 8) & 0x0F;
                        imm4 = ((ins >> 7) & 0x01) << 10;
                        imm = (((imm1 + imm2 + imm3 + imm4) << 1 ) << 19) >> 19;
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        if(rs1 != rs2) this.pc = this.pc + imm - 4|0;//-4 temporary hack
                        //message.Debug("bne - "+ utils.ToHex(rs2)+" register " + utils.ToHex((ins >> 20) & 0x1F));
                        break;

                    case 0x04:
                        //blt
                        imm1 = (ins >> 31) << 11;
                        imm2 = ((ins >> 25) & 0x3F) << 4;
                        imm3 = (ins >> 8) & 0x0F;
                        imm4 = ((ins >> 7) & 0x01) << 10;
                        imm = (((imm1 + imm2 + imm3 + imm4) << 1 ) << 19) >> 19;
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        if(rs1 < rs2) this.pc = this.pc + imm - 4|0;//-4 temporary hack
                        //message.Debug("blt - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x05:
                        //bge
                        imm1 = (ins >> 31) << 11;
                        imm2 = ((ins >> 25) & 0x3F) << 4;
                        imm3 = (ins >> 8) & 0x0F;
                        imm4 = ((ins >> 7) & 0x01) << 10;
                        imm = (((imm1 + imm2 + imm3 + imm4) << 1 ) << 19) >> 19;
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        if(rs1 >= rs2) this.pc = this.pc + imm - 4|0;//-4 temporary hack
                        //message.Debug("bge - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x06:
                        //bltu
                        imm1 = (ins >> 31) << 11;
                        imm2 = ((ins >> 25) & 0x3F) << 4;
                        imm3 = (ins >> 8) & 0x0F;
                        imm4 = ((ins >> 7) & 0x01) << 10;
                        imm = (((imm1 + imm2 + imm3 + imm4) << 1 ) << 19) >> 19;
                        rs1 = r[(ins >> 15) & 0x1F] >>> 0;
                        rs2 = r[(ins >> 20) & 0x1F] >>> 0;
                        if(rs1 < rs2) this.pc = this.pc + imm - 4|0;//-4 temporary hack
                        //message.Debug("bltu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x07:
                        //bgeu
                        imm1 = (ins >> 31) << 11;
                        imm2 = ((ins >> 25) & 0x3F) << 4;
                        imm3 = (ins >> 8) & 0x0F;
                        imm4 = ((ins >> 7) & 0x01) << 10;
                        imm = (((imm1 + imm2 + imm3 + imm4) << 1 ) << 19) >> 19;
                        rs1 = r[(ins >> 15) & 0x1F] >>> 0;
                        rs2 = r[(ins >> 20) & 0x1F] >>> 0;
                        if(rs1 >= rs2) this.pc = this.pc + imm - 4|0;//-4 temporary hack
                        //message.Debug("bgeu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    default:
                        //message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                        message.Abort();
                        break;

                }
                break;

            case 0x73:
                //csrrw,csrrs,csrrc,csrrwi,csrrsi,csrrci,ecall,eret,ebreak,mrts
                switch((ins >> 12)&0x7) {
                    
                    case 0x01:
                        //csrrw
                        imm = (ins >>> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = this.GetCSR(imm);
                        this.SetCSR(imm, rs1);
                        //message.Debug("csrrw - "+ utils.ToHex(ins)+" rs1 "+utils.ToHex(rs1)+" imm " + csr[imm]);
                        break;

                    case 0x02:
                        //csrrs
                        imm = (ins >>> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = this.GetCSR(imm);
                        this.SetCSR(imm, this.GetCSR(imm) | rs1);
                        //message.Debug("csrrs - "+ utils.ToHex(ins)+" rs1 "+utils.ToHex(rs1)+" imm " + csr[imm]);
                        break;

                    case 0x03:
                        //csrrc
                        imm = (ins >>> 20);
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = this.GetCSR(imm);
                        this.SetCSR(imm, this.GetCSR(imm) & (~rs1));
                        //message.Debug("csrrc - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x05:
                        //csrrwi
                        imm = (ins >>> 20);
                        zimm = (ins >> 15) & 0x1F;
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = this.GetCSR(imm);
                        if(zimm != 0) this.SetCSR(imm, (zimm >> 0));
                        //message.Debug("csrrwi - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;
                        

                    case 0x06:
                        //csrrsi
                        imm = (ins >>> 20);
                        zimm = (ins >> 15) & 0x1F;
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = this.GetCSR(imm);
                        if(zimm != 0) this.SetCSR(imm, this.GetCSR(imm) | (zimm >> 0));
                        //message.Debug("csrrsi - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x07:
                        //csrrci
                        imm = (ins >>> 20);
                        zimm = (ins >> 15) & 0x1F;
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = this.GetCSR(imm);
                        if(zimm != 0) this.SetCSR(imm, this.GetCSR(imm) & ~(zimm >> 0));
                        //message.Debug("csrrci - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;
                    
                    case 0x00:
                        //ecall,eret,ebreak,mrts
                        switch((ins >> 20)&0xFFF) {
                            case 0x00:
                                //ecall
                                var current_privilege_level = (csr[CSR_MSTATUS] & 0x06) >> 1;
                                switch(current_privilege_level)
                                {
                                    case PRV_U:
                                        //message.Debug("ecall PRV_U -"+ utils.ToHex(ins));
                                        this.PushPrivilegeStack(PRV_M);
                                        csr[CSR_MEPC] = this.pc;
                                        csr[CSR_MCAUSE] = 0x08;
                                        break;

                                    case PRV_S:
                                        //message.Debug("ecall PRV_S -"+ utils.ToHex(ins));
                                        this.PushPrivilegeStack(PRV_M);
                                        csr[CSR_MEPC] = this.pc;
                                        csr[CSR_MCAUSE] = 0x09;
                                        break;

                                    case PRV_H:
                                        //message.Debug("Not supported ecall PRV_H -"+ utils.ToHex(ins));
                                        this.PushPrivilegeStack(PRV_M);
                                        csr[CSR_MEPC] = this.pc;
                                        csr[CSR_MCAUSE] = 0x0A;
                                        message.Abort();
                                        break;

                                    case PRV_M:
                                        //message.Debug("ecall PRV_M -"+ utils.ToHex(ins));
                                        this.PushPrivilegeStack(PRV_M);
                                        csr[CSR_MEPC] = this.pc;
                                        csr[CSR_MCAUSE] = 0x0B;
                                        break;
                                    
                                    default:
                                        //message.Debug("Error in ecall: Don't know how to handle privilege level " + current_privilege_level);
                                        message.Abort();
                                        break;
                                }
                                this.pc =  0x100 + 0x40*current_privilege_level - 4|0;
                                break;

                            case 0x001:
                                //ebreak
                                this.Trap(CAUSE_BREAKPOINT);
                                break;

                            case 0x100:
                                //eret
                                var current_privilege_level = (csr[CSR_MSTATUS] & 0x06) >> 1;
                                if(current_privilege_level < PRV_S) {
                                    //message.Debug("Error in eret: current_privilege_level isn't allowed access");
                                    message.Abort();
                                    break;   
                                }
                                switch(current_privilege_level)
                                {
                                    
                                    case PRV_S:
                                        //message.Debug("eret PRV_S -"+ utils.ToHex(ins));
                                        this.PopPrivilegeStack(PRV_U);
                                        this.pc = csr[CSR_SEPC] - 4|0;
                                        break;

                                    case PRV_H:
                                        //message.Debug("Not supported eret PRV_H -"+ utils.ToHex(ins));
                                        this.PopPrivilegeStack(PRV_U);
                                        this.pc = csr[CSR_HEPC] - 4|0;
                                        message.Abort();
                                        break;

                                    case PRV_M:
                                        //message.Debug("eret PRV_M -"+ utils.ToHex(ins));
                                        this.PopPrivilegeStack(PRV_U);
                                        this.pc = csr[CSR_MEPC] - 4|0;
                                        break;
                                    
                                    default:
                                        //message.Debug("Error in eret: Don't know how to handle privilege level " + current_privilege_level);
                                        message.Abort();
                                        break;
                                }
                                break;

                            case 0x305:
                                //mrts     
                                if(current_privilege_level != PRV_M) {
                                    //message.Debug("Error in mrts: current_privilege_level isn't allowed access");
                                    message.Abort();
                                    break;   
                                }
                                csr[CSR_MSTATUS] = (csr[CSR_MSTATUS] & ~0x6) | 0x02; //Setting the Privilage level to Supervisor
                                csr[CSR_SBADADDR] = csr[CSR_MBADADDR];
                                csr[CSR_SCAUSE] = csr[CSR_MCAUSE];
                                csr[CSR_SEPC] = csr[CSR_MEPC];
                                this.pc = csr[CSR_STVEC] - 4|0;
                                break;

                            case 0x101:
                                //sfence.vm
                                break;

                            default:
                                //message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                                message.Abort();
                                break;

                        }
                        break; 

                    default:
                        //message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                        message.Abort();
                        break;

                }
                break;

            case 0x07:
                //flw,fld
                switch((ins >> 12)&0x7) {
                    
                    case 0x02:
                        //flw
                        imm = (ins >> 20);
                        fs1 = r[(ins >> 15) & 0x1F];
                        findex = ((ins >> 7) & 0x1F);
                        paddr = this.TranslateVM(fs1 + imm,VM_READ);
                        if(paddr == -1) break;
                        r[0] = this.ram.Read32(fs1 + imm);
                        f[findex] = ff[0];
                        //message.Debug("flw - "+ utils.ToHex(ins)+" register " + f[findex]);
                        break;

                    case 0x03:
                        //fld
                        imm = (ins >> 20);
                        fs1 = r[(ins >> 15) & 0x1F];
                        findex = ((ins >> 7) & 0x1F) << 1;
                        paddr = this.TranslateVM(fs1 + imm + 0,VM_READ);
                        if(paddr == -1) break;
                        fi[findex + 0] = this.ram.Read32(paddr);
                        paddr = this.TranslateVM(fs1 + imm + 4,VM_READ);
                        if(paddr == -1) break;
                        fi[findex + 1] = this.ram.Read32(paddr);
                        //message.Debug("fld - "+ utils.ToHex(ins)+" register " + fi[findex]);
                        break;

                    default:
                        //message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                        message.Abort();
                        break;

                }
                break;

            case 0x27:
                //fsw,fsd
                switch((ins >> 12)&0x7) {

                    case 0x02:
                        //fsw
                        imm1 = (ins >> 25);
                        imm2 = (ins >> 7) & 0x1F;
                        imm = (imm1 << 5) + imm2;
                        fs1 = r[(ins >> 15) & 0x1F];
                        findex = (ins >> 20) & 0x1F;
                        ff[0] = f[findex];
                        paddr = this.TranslateVM(fs1 + imm,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,r[0]);
                        //message.Debug("fsw - "+ utils.ToHex(ins)+" register " + f[findex]);
                        break;

                    case 0x03:
                        //fsd
                        imm1 = (ins >> 25);
                        imm2 = (ins >> 7) & 0x1F;
                        imm = (imm1 << 5) + imm2;
                        fs1 = r[(ins >> 15) & 0x1F];
                        findex = ((ins >> 20) & 0x1F) << 1;
                        paddr = this.TranslateVM(fs1 + imm + 0,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,fi[findex + 0]);
                        paddr = this.TranslateVM(fs1 + imm + 4,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,fi[findex + 1]);
                        //message.Debug("fsw - "+ utils.ToHex(ins)+" register " + fi[findex]);
                        break;

                    default:
                        //message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                        message.Abort();
                        break;

                }
                break;

            case 0x53:
                //fadd.s,fsub.s
                switch((ins >> 25)&0x7F) {
                    
                    case 0x00 :
                        //fadd.s
                        rs1 = f[(ins >> 15) & 0x1F];
                        rs2 = f[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        f[rindex] = rs1 + rs2;
                        //message.Debug("fadd.s - "+ utils.ToHex(ins)+" register " + f[rindex]);
                        break;

                    case 0x04:
                        //fsub.s
                        rs1 = f[(ins >> 15) & 0x1F];
                        rs2 = f[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        f[rindex] = rs1 - rs2;
                        //message.Debug("fsub.s - "+ utils.ToHex(ins)+" register " + f[rindex]);
                        break;

                    case 0x60:
                        //fcvt.w.s
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = f[(ins >> 15) & 0x1F];
                        //message.Debug("fcvt.w.s - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x01 :
                        //fadd.d
                        rs1 = f[(ins >> 15) & 0x1F];
                        rs2 = f[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        f[rindex] = rs1 + rs2;
                        //message.Debug("fadd.d - "+ utils.ToHex(ins)+" register " + f[rindex]);
                        break;

                    case 0x05:
                        //fsub.d
                        rs1 = f[(ins >> 15) & 0x1F];
                        rs2 = f[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        f[rindex] = rs1 - rs2;
                        //message.Debug("fsub.d - "+ utils.ToHex(ins)+" register " + f[rindex]);
                        break;

                    case 0x61:
                        //fcvt.w.d
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = f[(ins >> 15) & 0x1F];
                        //message.Debug("fcvt.w.s - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x78:
                        //fmv.s.x
                        rs1 = (ins >> 15) & 0x1F;
                        findex = (ins >> 7) & 0x1F;
                        r[0] = r[rs1];
                        f[findex] = ff[0]; 
                        //message.Debug("fmv.s.x - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;


                    default:
                        //message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + "not found");
                        message.Abort();
                        break;
                }
                break;

            case 0x2F:
                //amoswap,amoadd,amoxor,amoand,amoor,amomin,amomax,amominu,amomaxu
                switch((ins >> 27)&0x1F) {
                    
                    case 0x01:
                        //amoswap
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = this.ram.Read32(paddr);
                        paddr = this.TranslateVM(rs1,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,rs2);
                        //message.Debug("amoswap - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x00:
                        //amoadd
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = this.ram.Read32(paddr);
                        paddr = this.TranslateVM(rs1,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,r[rindex] + rs2);
                        //message.Debug("amoadd - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x04:
                        //amoxor
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = this.ram.Read32(paddr);
                        paddr = this.TranslateVM(rs1,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,r[rindex] ^ rs2);
                        //message.Debug("amoxor - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x0C:
                        //amoand
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = this.ram.Read32(paddr);
                        paddr = this.TranslateVM(rs1,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,r[rindex] & rs2);
                        //message.Debug("amoand - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x08:
                        //amoor
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = this.ram.Read32(paddr);
                        paddr = this.TranslateVM(rs1,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,r[rindex] | rs2);
                        //message.Debug("amoor - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x10:
                        //amomin
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = this.ram.Read32(paddr);
                        if((rs2 >> 0) > (r[rindex] >> 0)) r[0] = r[rindex];
                        else r[0] = rs2;
                        paddr = this.TranslateVM(rs1,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,r[0]);
                        //message.Debug("amomin - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                   case 0x14:
                        //amomax
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = this.ram.Read32(paddr);
                        if((rs2 >> 0) < (r[rindex] >> 0)) r[0] = r[rindex];
                        else r[0] = rs2;
                        paddr = this.TranslateVM(rs1,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,r[0]);
                        //message.Debug("amomax - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x18:
                        //amominu
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        r[rindex] = this.ram.Read32(paddr);
                        if((rs2 >>> 0) > (r[rindex] >>> 0)) r[0] = r[rindex];
                        else r[0] = rs2;
                        paddr = this.TranslateVM(rs1,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,r[0]);
                        //message.Debug("amominu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x1C:
                        //amomaxu
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = r[(ins >> 20) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = this.ram.Read32(paddr);
                        if((rs2 >>> 0) < (r[rindex] >>> 0)) r[0] = r[rindex];
                        else r[0] = rs2;
                        paddr = this.TranslateVM(rs1,VM_WRITE);
                        if(paddr == -1) break;
                        this.ram.Write32(paddr,r[0]);
                        //message.Debug("amomaxu - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x02:
                        //lr.d
                        rs1 = r[(ins >> 15) & 0x1F];
                        rindex = (ins >> 7) & 0x1F;
                        paddr = this.TranslateVM(rs1,VM_READ);
                        if(paddr == -1) break;
                        r[rindex] = this.ram.Read32(paddr);
                        this.amoaddr = rs1;
                        this.amovalue = r[rindex];
                        //message.Debug("lr.d - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    case 0x03:
                        //sc.d
                        rs1 = r[(ins >> 15) & 0x1F];
                        rs2 = (ins >> 20) & 0x1F;
                        rindex = (ins >> 7) & 0x1F;
                        if(rs1 != this.amoaddr) {
                            r[rindex] = 0x01;
                            break;
                        }
                        var physical_addr = this.TranslateVM(rs1, VM_READ);
                        if(physical_addr == -1) break;
                        if(this.ram.Read32(physical_addr) != this.amovalue) {
                            r[rindex] = 0x01;
                            break;
                        }
                        r[rindex] = 0x00;
                        var physical_addr = this.TranslateVM(rs1, VM_WRITE);
                        if(physical_addr == -1) break;
                        this.ram.Write32(physical_addr, r[rs2]);
                        //message.Debug("sc.d - "+ utils.ToHex(ins)+" register " + r[rindex]);
                        break;

                    default:
                        //message.Debug("Error in Atomic Memory Instruction " + utils.ToHex(ins) + "not found");
                        message.Abort();
                        break;

                }
                break;

            case 0x0F:
                //fence
                break;

            default:
                //message.Debug("Error in safecpu: Instruction " + utils.ToHex(ins) + " not found at "+utils.ToHex(this.pc));
                message.Abort();
                break;
        }

        //message.Debug(utils.ToHex(this.pc));
        this.pc = this.pc + 4|0;
        this.ticks = this.ticks + 1|0;
    } while(--steps);
    return 0;
};

module.exports = SafeCPU;
